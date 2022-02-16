/**
 * Code used by both main and renderer processes.
 */
export declare const API_REQUEST_IPC = "__api_request";
export declare const API_RESPONSE_IPC = "__api_response";
/**
 * Type to which a bound API of class T conforms. It only exposes the
 * methods of class T not containing underscores.
 */
export declare type ApiBinding<T> = {
    [K in Extract<keyof T, PublicProperty<keyof T>>]: T[K];
};
/**
 * Sets the timeout for the opposing process to expose or bind to an API.
 */
export declare function setIpcBindingTimeout(millis: number): void;
export declare type PrivateProperty<P> = P extends `_${string}` ? P : P extends `#${string}` ? P : never;
export declare type PublicProperty<P> = P extends PrivateProperty<P> ? never : P extends string ? P : never;
export declare type ApiRegistration = {
    className: string;
    methodNames: string[];
};
export declare type ApiRegistrationMap = Record<string, string[]>;
export declare function getPropertyNames(obj: any): string[];
export declare function toIpcName(apiClassName: string, methodName: string): string;
export declare function retryUntilTimeout(elapsedMillis: number, attemptFunc: () => boolean, timeoutMessage: string): void;
