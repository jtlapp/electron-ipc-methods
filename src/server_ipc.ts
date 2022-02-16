/**
 * Code specific to handling IPC in the main process.
 */

// TODO: revisit/revise all comments after removing most timeouts

import { ipcMain, BrowserWindow } from "electron";

import {
  API_REQUEST_IPC,
  API_RESPONSE_IPC,
  ApiRegistration,
  ApiRegistrationMap,
  ApiBinding,
  PublicProperty,
  toIpcName,
  getPropertyNames,
  retryUntilTimeout,
} from "./shared_ipc";
import { Restorer } from "./restorer";
// Use the publicly-exposed RestorerFunction type
import { RestorerFunction } from "./restorer";

//// MAIN API SUPPORT ////////////////////////////////////////////////////////

// Structure mapping API names to the methods each contains.
let _mainApiMap: ApiRegistrationMap = {};

// Error logger mainly of value for debugging the test suite.
let _errorLoggerFunc: (err: Error) => void;

/**
 * Type to which a main API of class T conforms, requiring each API to
 * return a promise. All properties of the method not beginning with an
 * underscore are considered IPC APIs. All properties beginning with an
 * underscore are ignored, allowing an API class to have internal
 * structure on which the APIs rely.
 */
export type ElectronMainApi<T> = {
  [K in keyof T]: K extends PublicProperty<K>
    ? (...args: any[]) => Promise<any>
    : any;
};

/**
 * Wrapper for exceptions occurring in a main API that are relayed to the
 * caller in the calling window. Any uncaught exception of a main API not
 * of this type is throw within Electron and not returned to the window.
 */
export class RelayedError {
  errorToRelay: any;

  constructor(errorToRelay: any) {
    this.errorToRelay = errorToRelay;
  }
}

/**
 * Exposes a main API to all windows for possible binding.
 *
 * @param <T> (inferred type, not specified in call)
 * @param mainApi The API to expose
 * @param restorer Optional function for restoring the classes of
 *    arguments passed to main. Instances of classes not restored arrive
 *    as untyped structures.
 */
export function exposeMainApi<T>(
  mainApi: ElectronMainApi<T>,
  restorer?: RestorerFunction
): void {
  const apiClassName = mainApi.constructor.name;
  _installIpcListeners();

  if (_mainApiMap[apiClassName]) {
    return; // was previously exposed
  }
  const methodNames: string[] = [];
  for (const methodName of getPropertyNames(mainApi)) {
    if (methodName != "constructor" && !["_", "#"].includes(methodName[0])) {
      const method = (mainApi as any)[methodName];
      if (typeof method == "function") {
        ipcMain.handle(
          toIpcName(apiClassName, methodName),
          async (_event, args: any[]) => {
            try {
              if (args !== undefined) {
                for (let i = 0; i < args.length; ++i) {
                  args[i] = Restorer.restoreValue(args[i], restorer);
                }
              }
              //await before returning to keep Electron from writing errors
              const replyValue = await method.bind(mainApi)(...args);
              return Restorer.makeRestorable(replyValue);
            } catch (err: any) {
              if (err instanceof RelayedError) {
                return Restorer.makeReturnedError(err.errorToRelay);
              }
              if (_errorLoggerFunc !== undefined) {
                _errorLoggerFunc(err);
              }
              throw err;
            }
          }
        );
        methodNames.push(methodName);
      }
    }
  }
  _mainApiMap[apiClassName] = methodNames;
}

/**
 * Receives errors thrown in APIs not wrapped in RelayedError.
 */
export function setIpcErrorLogger(loggerFunc: (err: Error) => void): void {
  _errorLoggerFunc = loggerFunc;
}

//// WINDOW API SUPPORT //////////////////////////////////////////////////////

// TODO: purge window data when window closes

// Structure mapping window API names to the methods they contain, indexed by
// web contents ID.
const _windowApiMapByWebContentsID: Record<number, ApiRegistrationMap> = {};

// Structure tracking bound window APIs, indexed by window ID.
// TODO: Can I replace WindowApiBinding<any> with 'true'?
const _boundWindowApisByWindowID: Record<
  number,
  Record<string, ApiBinding<any>>
> = {};

/**
 * Returns a main-side binding for a window API of a given class, restricting
 * the binding to the given window. Failure of the window to expose the API
 * before timeout results in an error.
 *
 * @param <T> Class to which to bind.
 * @param apiClassName Name of the class being bound. Must be identical to
 *    the name of class T. Provides runtime information that <T> does not.
 * @returns An API of type T that can be called as if T were local.
 */
export function bindWindowApi<T>(
  window: BrowserWindow,
  apiClassName: string
): Promise<ApiBinding<T>> {
  _installIpcListeners();

  return new Promise((resolve) => {
    const windowApis = _boundWindowApisByWindowID[window.webContents.id];
    if (windowApis && windowApis[apiClassName]) {
      resolve(windowApis[apiClassName]);
    } else {
      retryUntilTimeout(
        0,
        () => {
          return _attemptBindWindowApi(window, apiClassName, resolve);
        },
        `Main timed out waiting to bind to window API '${apiClassName}'` +
          ` (window ID ${window.id})`
      );
    }
  });
}

// Implements a single attempt to bind to a window API.
function _attemptBindWindowApi<T>(
  window: BrowserWindow,
  apiClassName: string,
  resolve: (boundApi: ApiBinding<T>) => void
): boolean {
  let windowApiMap = _windowApiMapByWebContentsID[window.webContents.id];
  if (!windowApiMap || !windowApiMap[apiClassName]) {
    window.webContents.send(API_REQUEST_IPC, apiClassName);
    return false;
  }
  const methodNames = windowApiMap[apiClassName] as [keyof ApiBinding<T>];
  const boundApi = {} as ApiBinding<T>;
  for (const methodName of methodNames) {
    const typedMethodName: keyof ApiBinding<T> = methodName;
    boundApi[typedMethodName] = ((...args: any[]) => {
      if (args !== undefined) {
        for (const arg of args) {
          Restorer.makeRestorable(arg);
        }
      }
      window.webContents.send(
        toIpcName(apiClassName, methodName as string),
        args
      );
    }) as any; // typescript can't confirm the method signature
  }
  let windowApis = _boundWindowApisByWindowID[window.webContents.id];
  if (!windowApis) {
    windowApis = {};
    _boundWindowApisByWindowID[window.webContents.id] = windowApis;
  }
  windowApis[apiClassName] = boundApi;
  resolve(boundApi);
  return true;
}

//// COMMON MAIN & WINDOW SUPPORT API ////////////////////////////////////////

let _listeningForIPC = false;

function _installIpcListeners() {
  if (!_listeningForIPC) {
    // TODO: revisit the request/expose protocol
    ipcMain.on(API_REQUEST_IPC, (event, apiClassName: string) => {
      const registration: ApiRegistration = {
        className: apiClassName,
        methodNames: _mainApiMap[apiClassName],
      };
      event.sender.send(API_RESPONSE_IPC, registration);
    });
    ipcMain.on(API_RESPONSE_IPC, (event, api: ApiRegistration) => {
      let windowApiMap = _windowApiMapByWebContentsID[event.sender.id];
      if (!windowApiMap) {
        windowApiMap = {};
        _windowApiMapByWebContentsID[event.sender.id] = windowApiMap;
      }
      windowApiMap[api.className] = api.methodNames;
    });
    _listeningForIPC = true;
  }
}
