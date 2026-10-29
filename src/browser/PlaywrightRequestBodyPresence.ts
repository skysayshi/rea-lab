import type { Page } from "playwright-core";

import type {
  BrowserRequestBodyPresenceObservation,
  BrowserRequestBodyPresenceProducer,
} from "../domain/browserRequestBodyPresence.js";

export interface PresencePageRequest {
  readonly url: string;
  readonly origin: string;
  readonly method: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string | undefined;
  readonly deadline: number | undefined;
  readonly presence: {
    readonly run_id: string;
    /** The runtime-generated X-Rea-Presence-Token, not a caller assertion. */
    readonly request_id: string;
    readonly observe: boolean;
    readonly measure: boolean;
    readonly max_body_bytes: number;
    readonly read_timeout_ms: number;
  };
}

export interface PresencePageObservation {
  readonly observation: BrowserRequestBodyPresenceObservation;
  readonly producer: BrowserRequestBodyPresenceProducer;
}

export type PresencePageResponse = (
  | { readonly status: number }
  | { readonly redirected: true }
  | { readonly left: string }
  | { readonly error: string }
) & { readonly presence?: PresencePageObservation };

/**
 * Self-contained because Playwright serializes this function into the page.
 * It instruments only its own synthetic Request; it does not replace page fetch.
 */
export const performPresenceRequestInPage = async (
  input: PresencePageRequest,
): Promise<PresencePageResponse> => {
  const here = (globalThis as { readonly location?: { origin: string } })
    .location?.origin;
  if (here !== input.origin) return { left: String(here) };
  if (
    (
      globalThis as {
        readonly navigator?: { serviceWorker?: { controller?: unknown } };
      }
    ).navigator?.serviceWorker?.controller
  )
    return {
      error:
        "Presence requests require a page without a controlling service worker.",
    };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let presence: PresencePageObservation | undefined;
  try {
    const requireValue = (condition: boolean, message: string): void => {
      if (!condition) throw new Error(message);
    };
    const destination = new URL(input.url);
    requireValue(
      destination.origin === input.origin &&
        destination.protocol === "http:" &&
        (destination.hostname === "127.0.0.1" ||
          destination.hostname === "[::1]") &&
        destination.pathname === "/presence" &&
        destination.username === "" &&
        destination.password === "",
      "Presence requests require the declared literal loopback /presence endpoint.",
    );
    const options = input.presence;
    requireValue(
      /^[A-Za-z0-9._:-]{1,160}$/u.test(options.run_id) &&
        /^[A-Za-z0-9._:-]{1,160}$/u.test(options.request_id),
      "Presence requests require runtime-owned run and request identifiers.",
    );
    requireValue(
      Number.isSafeInteger(options.max_body_bytes) &&
        options.max_body_bytes > 0 &&
        options.max_body_bytes <= 4096 &&
        Number.isSafeInteger(options.read_timeout_ms) &&
        options.read_timeout_ms > 0 &&
        options.read_timeout_ms <= 250,
      "Presence measurement exceeds its bounded synthetic limits.",
    );
    requireValue(
      typeof options.observe === "boolean" &&
        typeof options.measure === "boolean",
      "Presence observation controls must be boolean.",
    );
    const remaining =
      input.deadline === undefined ? undefined : input.deadline - Date.now();
    if (remaining !== undefined && remaining <= 0)
      return { error: "The request ran out of time before it was sent." };

    // Capture realm intrinsics before creating the owned Request. All subsequent
    // checks bypass own-property shadows on that object and its clone.
    const NativeRequest = globalThis.Request;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const nativeClone = NativeRequest.prototype.clone;
    const bodyGetter = Object.getOwnPropertyDescriptor(
      NativeRequest.prototype,
      "body",
    )?.get;
    const usedGetter = Object.getOwnPropertyDescriptor(
      NativeRequest.prototype,
      "bodyUsed",
    )?.get;
    const urlGetter = Object.getOwnPropertyDescriptor(
      NativeRequest.prototype,
      "url",
    )?.get;
    const methodGetter = Object.getOwnPropertyDescriptor(
      NativeRequest.prototype,
      "method",
    )?.get;
    const headersGetter = Object.getOwnPropertyDescriptor(
      NativeRequest.prototype,
      "headers",
    )?.get;
    const redirectGetter = Object.getOwnPropertyDescriptor(
      NativeRequest.prototype,
      "redirect",
    )?.get;
    const lockedGetter = Object.getOwnPropertyDescriptor(
      ReadableStream.prototype,
      "locked",
    )?.get;
    if (
      !bodyGetter ||
      !usedGetter ||
      !urlGetter ||
      !methodGetter ||
      !headersGetter ||
      !redirectGetter ||
      !lockedGetter
    )
      throw new Error("Required native Request intrinsics are unavailable.");
    const headersGet = Headers.prototype.get;
    const getReader = ReadableStream.prototype.getReader;
    const read = ReadableStreamDefaultReader.prototype.read;
    const cancel = ReadableStreamDefaultReader.prototype.cancel;
    const release = ReadableStreamDefaultReader.prototype.releaseLock;
    const digest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    const controller = new AbortController();
    if (remaining !== undefined)
      timer = setTimeout(() => controller.abort(), remaining);
    const request = new NativeRequest(input.url, {
      method: input.method,
      headers: input.headers.map(([name, value]) => [name, value]),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    const handle = Object.freeze({});
    const byRequest = new WeakMap<Request, object>([[request, handle]]);
    const byHandle = new WeakMap<object, Request>([[handle, request]]);
    let dispatched = false;
    let sequence = 1; // Request ownership was established before observation.
    const inspect = (
      original: Request,
      ownedHandle: object,
    ): ReadableStream<Uint8Array> | null => {
      requireValue(
        byRequest.get(original) === ownedHandle &&
          byHandle.get(ownedHandle) === original,
        "A foreign handle or different Request cannot supply presence evidence.",
      );
      const body = bodyGetter.call(
        original,
      ) as ReadableStream<Uint8Array> | null;
      const headers = headersGetter.call(original) as Headers;
      requireValue(
        urlGetter.call(original) === destination.href &&
          methodGetter.call(original) === input.method &&
          redirectGetter.call(original) === "error" &&
          headersGet.call(headers, "X-Rea-Presence-Run") === options.run_id &&
          headersGet.call(headers, "X-Rea-Presence-Token") ===
            options.request_id,
        "Owned Request metadata or runtime correlation changed.",
      );
      requireValue(
        usedGetter.call(original) === false,
        "Original Request body is disturbed.",
      );
      requireValue(
        body === null || lockedGetter.call(body) === false,
        "Original Request body is locked.",
      );
      return body;
    };
    const observedBody = inspect(request, handle);
    let observation: BrowserRequestBodyPresenceObservation;
    sequence += 1;
    if (!options.observe) {
      observation = {
        status: "disabled",
        reason: "producer-observation-disabled",
      };
    } else {
      type Measurement = Extract<
        BrowserRequestBodyPresenceObservation,
        { status: "observed" }
      >["measurement"];
      let measurement: Measurement =
        observedBody === null
          ? { status: "not-applicable", reason: "body-is-null" }
          : { status: "not-requested" };
      if (observedBody !== null && options.measure) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let reachedEnd = false;
        let measuredBytes = 0;
        const chunks: Uint8Array[] = [];
        const readDeadline = performance.now() + options.read_timeout_ms;
        const withinDeadline = async <Value>(
          operation: () => Promise<Value>,
        ): Promise<Value> => {
          const available = readDeadline - performance.now();
          if (available <= 0) throw new Error("clone-read-timeout");
          let readTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              operation(),
              new Promise<never>((_, reject) => {
                readTimer = setTimeout(
                  () => reject(new Error("clone-read-timeout")),
                  available,
                );
              }),
            ]);
          } finally {
            if (readTimer !== undefined) clearTimeout(readTimer);
          }
        };
        try {
          const clone = nativeClone.call(request);
          const cloneBody = bodyGetter.call(
            clone,
          ) as ReadableStream<Uint8Array> | null;
          if (cloneBody === null)
            throw new Error("Present body cloned as absent.");
          reader = getReader.call(
            cloneBody,
          ) as ReadableStreamDefaultReader<Uint8Array>;
          while (true) {
            const part = await withinDeadline(
              () =>
                read.call(reader) as Promise<
                  | { readonly done: true; readonly value?: undefined }
                  | { readonly done: false; readonly value: Uint8Array }
                >,
            );
            if (part.done) {
              reachedEnd = true;
              break;
            }
            requireValue(
              part.value instanceof Uint8Array,
              "clone-read-returned-nonbytes",
            );
            measuredBytes += part.value.byteLength;
            requireValue(
              measuredBytes <= options.max_body_bytes,
              "clone-body-size-limit",
            );
            chunks.push(new Uint8Array(part.value));
          }
          const bytes = new Uint8Array(measuredBytes);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const digestBytes = new Uint8Array(
            await withinDeadline(() => digest("SHA-256", bytes)),
          );
          const sha256 = Array.from(digestBytes, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          inspect(request, handle);
          measurement = { status: "complete", bytes: measuredBytes, sha256 };
        } catch (cause: unknown) {
          measurement = {
            status: "incomplete",
            reason: cause instanceof Error ? cause.message : String(cause),
          };
        } finally {
          if (reader !== undefined && !reachedEnd) {
            // Cancellation of a tee branch can await its original. Never await
            // it here; the scenario owns the browser context and its teardown.
            try {
              void cancel
                .call(reader, "bounded-presence-read-ended")
                .catch(() => {});
            } catch {
              /* A settled or released reader requires no second cancellation. */
            }
          }
          if (reader !== undefined) {
            try {
              release.call(reader);
            } catch {
              /* Context teardown owns a lock that could not be released. */
            }
          }
        }
        sequence += 1;
      }
      observation = {
        status: "observed",
        body_is_null: observedBody === null,
        measurement,
      };
    }
    requireValue(!dispatched, "An owned Request cannot be dispatched twice.");
    if (
      controller.signal.aborted ||
      (input.deadline !== undefined && Date.now() >= input.deadline)
    )
      return { error: "The request ran out of time before it was sent." };
    inspect(request, handle);
    dispatched = true;
    presence = {
      observation,
      producer: {
        source: "runtime-owned-fetch-request",
        run_id: options.run_id,
        request_id: options.request_id,
        dispatch_sequence: ++sequence,
        same_request_verified: true,
      },
    };
    // No await, reconstruction, or caller callback separates identity validation
    // from dispatch of this very object through the captured fetch function.
    const pendingResponse = nativeFetch(request);
    const response = await pendingResponse;
    const responseReader = response.body?.getReader();
    if (responseReader !== undefined)
      try {
        while (!(await responseReader.read()).done) {
          /* Drain without retaining another response. */
        }
      } finally {
        responseReader.releaseLock();
      }
    return response.type === "opaqueredirect"
      ? { redirected: true, presence }
      : { status: response.status, presence };
  } catch (cause: unknown) {
    return {
      error: cause instanceof Error ? cause.message : String(cause),
      ...(presence === undefined ? {} : { presence }),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const sendPresenceFromPage = (
  page: Page,
  input: PresencePageRequest,
): Promise<PresencePageResponse> =>
  page.evaluate(performPresenceRequestInPage, input);
