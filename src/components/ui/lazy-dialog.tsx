"use client"

import * as React from "react"
import { toast } from "sonner"

import type { DialogHandle } from "@/components/ui/dialog"

// PERF-25/26: a dialog is most of a heavy page's unused JavaScript (a form, its
// validation, Base UI's Combobox, an OCR reader, …) and nobody sees one until
// they tap something. This keeps a dialog's code out of the page's own
// chunk: the page declares a *loader* for it, and a <LazyDialog> host mounts
// the real component only once it has been asked to open.
//
// "Not slower than today" is the constraint (DESIGN.md: instant feedback), so
// the chunk is fetched before it's needed, three ways:
//   1. in idle time after the host hydrates (scheduleIdle below), which is
//      what usually makes the first tap as fast as before,
//   2. on pointer-enter / focus / touch-start of whatever opens it
//      (preloadOnIntent), for the case the idle slot hasn't come yet,
//   3. and if a tap still beats both, the dialog opens as soon as the chunk
//      arrives (the host remembers the request) rather than being dropped.
//
// Opening goes through the same Base UI handle the pages already use, so a
// dialog keeps its onOpenChange / open-time reset logic and the menu items
// that open it only swap `handle.open(null)` for `openLazyDialog(handle)`.

type Component = React.ComponentType<never>

export type LazyDialogLoader<C extends Component> = {
  /** Starts (once) and returns the import. A failed import is retried next time. */
  load: () => Promise<C>
  /** The component once loaded, else undefined. */
  get: () => C | undefined
  /** `load()` for fire-and-forget callers: errors are left to the next real open. */
  preload: () => void
}

/**
 * Wraps `() => import("./x").then((m) => m.X)`. Declare it at module level so
 * every host and trigger of one dialog shares the same promise and cache.
 */
export function createLazyDialogLoader<C extends Component>(
  importer: () => Promise<C>
): LazyDialogLoader<C> {
  let promise: Promise<C> | undefined
  let loaded: C | undefined
  const load = () => {
    if (!promise) {
      promise = importer().then(
        (component) => {
          loaded = component
          return component
        },
        (error) => {
          // Forget it, so a flaky network on the idle prefetch doesn't make
          // the dialog impossible to open for the rest of the session.
          promise = undefined
          throw error
        }
      )
    }
    return promise
  }
  return {
    load,
    get: () => loaded,
    preload: () => {
      load().catch(() => {})
    },
  }
}

/**
 * Runs `task` when the browser is idle. Safari has no requestIdleCallback, so
 * a short timeout stands in for it. Returns the cancel function.
 */
export function scheduleIdle(task: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(task, { timeout: 4000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(task, 200)
  return () => window.clearTimeout(id)
}

/** Props that fetch a dialog's chunk when the user reaches for its opener. */
export function preloadOnIntent(loader: Pick<LazyDialogLoader<Component>, "preload">) {
  return {
    onPointerEnter: loader.preload,
    onFocus: loader.preload,
    onTouchStart: loader.preload,
  }
}

/**
 * What to tell the user when a dialog's chunk can't be fetched (offline, or
 * replaced by a deploy since the page loaded). A page passes an existing
 * "something went wrong" string, so the primitive needs no copy of its own.
 */
const LoadErrorContext = React.createContext<string | null>(null)
export function LazyDialogErrorMessage({ message, children }: { message: string; children: React.ReactNode }) {
  return <LoadErrorContext.Provider value={message}>{children}</LoadErrorContext.Provider>
}

/**
 * Loads a dialog's chunk and reports the outcome: `onLoaded` on success,
 * `onFailed` on a failed import. A failure leaves the loader empty, so asking
 * again retries the import (see createLazyDialogLoader).
 */
export async function loadLazyDialog(
  loader: Pick<LazyDialogLoader<Component>, "load">,
  onLoaded: () => void,
  onFailed: () => void
) {
  try {
    await loader.load()
  } catch {
    onFailed()
    return
  }
  onLoaded()
}

type Host = { request: () => void }
const hosts = new WeakMap<DialogHandle, Host>()

/**
 * Opens the dialog behind `handle`: through its <LazyDialog> host (which loads
 * and mounts it first when needed), or straight through the handle when the
 * dialog isn't lazy.
 */
export function openLazyDialog(handle: DialogHandle) {
  const host = hosts.get(handle)
  if (host) host.request()
  else handle.open(null)
}

/**
 * Mounts the dialog from `loader` the first time it is asked to open, and
 * keeps it mounted afterwards (its close animation and state stay as before).
 *
 * Two ways to ask: `openLazyDialog(handle)` for a dialog that opens through a
 * handle, or `open` for one the parent controls with its own `open` prop (it
 * mounts the first time `open` is true). `children` receives the loaded
 * component and renders it with its usual props.
 */
export function LazyDialog<C extends Component>({
  loader,
  handle,
  open = false,
  fallback = null,
  onLoadError,
  children,
}: {
  loader: LazyDialogLoader<C>
  handle?: DialogHandle
  open?: boolean
  /** Shown until the dialog is mounted, for a component that owns its opener
   * (a stand-in with the same look, which asks for the real one on tap). */
  fallback?: React.ReactNode
  /** The chunk failed to load. A dialog driven by `open` must close it (or
   * reset whatever set it) here, or the next tap can't retry. */
  onLoadError?: () => void
  children: (Dialog: C) => React.ReactNode
}) {
  const [requested, setRequested] = React.useState(false)
  const [, rerender] = React.useReducer((count: number) => count + 1, 0)
  // Set by openLazyDialog; consumed once the real dialog is mounted, because a
  // Base UI handle ignores open() until a Root using it is attached.
  const openWhenMounted = React.useRef(false)
  const mounted = React.useRef(false)

  const errorMessage = React.useContext(LoadErrorContext)
  // Latest values for the async failure path, which outlives the render.
  const onFailureRef = React.useRef({ errorMessage, onLoadError })
  React.useEffect(() => {
    onFailureRef.current = { errorMessage, onLoadError }
  })

  const loadAndRender = React.useCallback(() => {
    void loadLazyDialog(loader, rerender, () => {
      // The import failed. Say so, drop the request and let the owner reset
      // what asked for it: a handle dialog just retries on the next tap, but
      // one driven by `open` only reloads when `open` goes false -> true
      // again, so its owner has to close it (onLoadError).
      openWhenMounted.current = false
      const { errorMessage: message, onLoadError: reset } = onFailureRef.current
      if (message) toast.error(message)
      reset?.()
    })
  }, [loader])

  // Adjusting state during render, the way the repo's other "reset on open"
  // code does: a controlled dialog is mounted from its first `open`.
  if (open && !requested) setRequested(true)

  React.useEffect(() => {
    if (!handle) return
    hosts.set(handle, {
      request: () => {
        // Already mounted by an earlier open: nothing to wait for.
        if (mounted.current) return handle.open(null)
        openWhenMounted.current = true
        setRequested(true)
        loadAndRender()
      },
    })
    return () => {
      hosts.delete(handle)
    }
  }, [handle, loadAndRender])

  React.useEffect(() => scheduleIdle(loader.preload), [loader])

  React.useEffect(() => {
    if (open) loadAndRender()
  }, [open, loadAndRender])

  const Dialog = requested ? loader.get() : undefined

  // Runs after the dialog's own effects (children first), so its Root is
  // attached to the handle by now.
  React.useEffect(() => {
    if (Dialog) mounted.current = true
    if (Dialog && handle && openWhenMounted.current) {
      openWhenMounted.current = false
      handle.open(null)
    }
  }, [Dialog, handle])

  return Dialog ? <>{children(Dialog)}</> : <>{fallback}</>
}
