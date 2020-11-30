/**
 * @license
 * Copyright 2019 Google LLC
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

import { registerVersion, _registerComponent } from '@firebase/app-exp';
import { FirebaseAnalyticsInternal } from '@firebase/analytics-interop-types';
import { factory, resetGlobalVars, getGlobalVars } from './factory';
import { ANALYTICS_TYPE } from './constants';
import {
  Component,
  ComponentType,
  ComponentContainer
} from '@firebase/component';
import { ERROR_FACTORY, AnalyticsError } from './errors';
import { logEvent } from './api';
import { name, version } from '../package.json';
import { AnalyticsCallOptions } from '@firebase/analytics-types-exp';

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

export * from './api';

function registerAnalytics(): void {
  _registerComponent(
    new Component(
      ANALYTICS_TYPE,
      container => {
        // getImmediate for FirebaseApp will always succeed
        const app = container.getProvider('app-exp').getImmediate();
        const installations = container
          .getProvider('installations-exp-internal')
          .getImmediate();

        return factory(app, installations);
      },
      ComponentType.PUBLIC
    )
  );

  _registerComponent(
    new Component('analytics-internal', internalFactory, ComponentType.PRIVATE)
  );

  registerVersion(name, version);

  function internalFactory(
    container: ComponentContainer
  ): FirebaseAnalyticsInternal {
    try {
      const analytics = container.getProvider(ANALYTICS_TYPE).getImmediate();
      return {
        logEvent: (
          eventName: string,
          eventParams?: { [key: string]: unknown },
          options?: AnalyticsCallOptions
        ) => logEvent(analytics, eventName, eventParams, options)
      };
    } catch (e) {
      throw ERROR_FACTORY.create(AnalyticsError.INTEROP_COMPONENT_REG_FAILED, {
        reason: e
      });
    }
  }
}

export { factory, resetGlobalVars, getGlobalVars };

registerAnalytics();