/**
 * Hydration Sentinel — Injected at document_start
 * 
 * Captures the raw Server-Side Rendered (SSR) HTML before the
 * Angular client runtime boots and potentially mutates/clears it.
 */

(function() {
  // Capture initial snapshot of the body
  // This is used for 'Hydration Mismatch' diffing later.
  const ssrSnapshot = document.body ? document.body.innerHTML : '';
  
  // Store in global window for the main orchestrator to find
  (window as any).__NGLENS_SSR_SNAPSHOT__ = ssrSnapshot;
  
  // Also capture potential mismatches early
  window.addEventListener('ng-hydration-mismatch', (event: any) => {
    (window as any).__NGLENS_HYDRATION_ERROR__ = {
      timestamp: Date.now(),
      details: event.detail,
      serverHtml: ssrSnapshot,
      clientHtml: document.body.innerHTML
    };
  });
})();
