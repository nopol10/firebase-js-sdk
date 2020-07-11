/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'fs';
import { resolve, basename } from 'path';
import {
  extractDependenciesAndSize,
  extractDeclarations,
  MemberList,
  ExportData,
  writeReportToDirectory,
  writeReportToFile,
  ErrorCode
} from './analysis-helper';
import { mapWorkspaceToPackages } from '../../scripts/release/utils/workspace';
import { projectRoot } from '../../scripts/utils';
import * as yargs from 'yargs';

export const TYPINGS: string = 'typings';
const BUNDLE: string = 'esm2017';

/**
 * Support Command Line Options
 * -- inputModule (optional) : can be left unspecified which results in running analysis on all exp modules.
 *            can specify one to many module names seperated by space.
 *            eg: --inputModule "@firebase/functions-exp" "firebase/auth-exp"
 *
 * -- inputDtsFile (optional) : adhoc support. Specify a path to dts file. Must enable -- inputBundleFile if this flag is specified.
 *
 * -- inputBundleFile (optional): adhoc support. Specify a path to bundle file. Must enable -- inputDtsFile if this flag is specified.
 *
 * --ci (optional): if enabled, upload report to ci backend. One of --ci and --output flag must be specified for output redirection.
 *
 *
 * --output (optional): output directory or file where reports will be generated.
 *          specify a directory if module(s) are analyzed
 *          specify a file path if ad hoc analysis is to be performed
 *          One of --ci and --output flag must be specified for output redirection.
 *
 */
const argv = yargs
  .options({
    inputModule: {
      type: 'array',
      alias: 'im',
      desc:
        'The name of the module(s) to be analyzed. example: --inputModule "@firebase/functions-exp" "firebase/auth-exp"'
    },
    inputDtsFile: {
      type: 'string',
      alias: 'if',
      desc: 'support for adhoc analysis. requires a path to dts file'
    },
    inputBundleFile: {
      type: 'string',
      alias: 'ib',
      desc: 'support for adhoc analysis. requires a path to a bundle file'
    },
    ci: {
      type: 'boolean',
      alias: 'ci',
      default: false,
      desc:
        "when enabled, the binary size report is not persisted on file system; Instead, it's uploaded to CI backend"
    },
    output: {
      type: 'string',
      alias: 'o',
      desc:
        'The location where report(s) will be generated, a directory path if module(s) are analyzed; a file path if ad hoc analysis is to be performed'
    }
  })
  .help().argv;

/**
 * This functions takes in a module location, retrieve path to dts file of the module,
 * extract exported symbols, and generate a json report accordingly.
 */
async function generateReportForModule(
  path: string,
  outputDirectory: string,
  writeFiles: boolean,
  uploadToCI: boolean
): Promise<void> {
  const packageJsonPath = `${path}/package.json`;
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }
  const packageJson = require(packageJsonPath);
  // to exclude <modules>-types modules
  if (packageJson[TYPINGS]) {
    const dtsFile = `${path}/${packageJson[TYPINGS]}`;
    if (!packageJson[BUNDLE]) {
      throw new Error(ErrorCode.BUNDLE_FILE_DOES_NOT_EXIST);
    }
    const bundleFile = `${path}/${packageJson[BUNDLE]}`;
    const json = await generateReport(dtsFile, bundleFile);
    const fileName = `${basename(packageJson.name)}-dependency.json`;
    if (writeFiles) {
      writeReportToDirectory(json, fileName, resolve(outputDirectory));
    }
    if (uploadToCI) {
      uploadReportToCI();
    }
  }
}
/**
 *
 * This function creates a map from a MemberList object which maps symbol names (key) listed
 * to its type (value)
 */
function buildMap(api: MemberList): Map<string, string> {
  const map: Map<string, string> = new Map();
  Object.keys(api).map(key => {
    api[key].forEach(element => {
      map.set(element, key);
    });
  });
  return map;
}

/**
 * A recursive function that locates and generates reports for sub-modules
 */
function traverseDirs(
  moduleLocation: string,
  outputDirectory: string,
  writeFiles: boolean,
  uploadToCI: boolean,
  executor,
  level: number,
  levelLimit: number
): void {
  if (level > levelLimit) {
    return;
  }

  executor(moduleLocation, outputDirectory, writeFiles, uploadToCI);

  for (const name of fs.readdirSync(moduleLocation)) {
    const p = `${moduleLocation}/${name}`;

    if (fs.lstatSync(p).isDirectory()) {
      traverseDirs(
        p,
        outputDirectory,
        writeFiles,
        uploadToCI,
        executor,
        level + 1,
        levelLimit
      );
    }
  }
}

/**
 *
 * This functions builds the final json report for the module.
 * @param publicApi all symbols extracted from the input dts file.
 * @param jsFile a bundle file generated by rollup according to the input dts file.
 * @param map maps every symbol listed in publicApi to its type. eg: aVariable -> variable.
 */
async function buildJsonReport(
  publicApi: MemberList,
  jsFile: string,
  map: Map<string, string>
): Promise<string> {
  const result: { [key: string]: ExportData } = {};
  for (const exp of publicApi.classes) {
    result[exp] = await extractDependenciesAndSize(exp, jsFile, map);
  }
  for (const exp of publicApi.functions) {
    result[exp] = await extractDependenciesAndSize(exp, jsFile, map);
  }
  for (const exp of publicApi.variables) {
    result[exp] = await extractDependenciesAndSize(exp, jsFile, map);
  }

  for (const exp of publicApi.enums) {
    result[exp] = await extractDependenciesAndSize(exp, jsFile, map);
  }
  return JSON.stringify(result, null, 4);
}

async function generateReport(
  dtsFile: string,
  bundleFile: string
): Promise<string> {
  const resolvedDtsFile = resolve(dtsFile);
  const resolvedBundleFile = resolve(bundleFile);
  if (!fs.existsSync(resolvedDtsFile) || !fs.existsSync(resolvedBundleFile)) {
    throw new Error(ErrorCode.INPUT_FILE_DOES_NOT_EXIST);
  }
  const publicAPI = extractDeclarations(resolvedDtsFile);
  console.log(publicAPI);
  const map: Map<string, string> = buildMap(publicAPI);
  return buildJsonReport(publicAPI, bundleFile, map);
}

function uploadReportToCI(): void {
  console.log('TODO');
}
function generateReportForModules(
  moduleLocations: string[],
  outputDirectory: string,
  writeFiles: boolean,
  uploadToCI: boolean
): void {
  for (const moduleLocation of moduleLocations) {
    // we traverse the dir in order to include binaries for submodules, e.g. @firebase/firestore/memory
    // Currently we only traverse 1 level deep because we don't have any submodule deeper than that.
    traverseDirs(
      moduleLocation,
      outputDirectory,
      writeFiles,
      uploadToCI,
      generateReportForModule,
      0,
      1
    );
  }
}

/**
 * Entry Point of the Tool.
 * The function first checks if it's an adhoc run (by checking whether --inputDtsFile and --inputBundle are both enabled)
 * The function then checks whether --inputModule flag is specified; Run analysis on all modules if not, run analysis on selected modules if enabled.
 * Throw INVALID_FLAG_COMBINATION error if neither case fulfill.
 */
async function main(): Promise<void> {
  if (!argv.output && !argv.ci) {
    throw new Error(ErrorCode.REPORT_REDIRECTION_ERROR);
  }
  // check if it's an adhoc run
  // adhoc run report can only be redirected to files
  if (argv.inputDtsFile && argv.inputBundleFile && argv.output) {
    const jsonReport = await generateReport(
      argv.inputDtsFile,
      argv.inputBundleFile
    );
    writeReportToFile(jsonReport, resolve(argv.output));
  } else if (!argv.inputDtsFile && !argv.inputBundleFile) {
    // retrieve All Module Names
    let allModulesLocation = await mapWorkspaceToPackages([
      `${projectRoot}/packages-exp/*`
    ]);
    if (argv.inputModule) {
      allModulesLocation = allModulesLocation.filter(path => {
        const json = require(`${path}/package.json`);
        return argv.inputModule.includes(json.name);
      });
    }
    let writeFiles: boolean = false;
    let uploadToCI: boolean = false;
    if (argv.output) {
      writeFiles = true;
    }
    if (argv.ci) {
      uploadToCI = true;
    }
    generateReportForModules(
      allModulesLocation,
      argv.output,
      writeFiles,
      uploadToCI
    );
  } else {
    throw new Error(ErrorCode.INVALID_FLAG_COMBINATION);
  }
}

main();