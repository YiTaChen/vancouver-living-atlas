# Mobile-compatible graphics — 2026-09-06

Reported symptom: iPhone 12 and other mobile users see black 3D output with working UI, advancing time and an FPS counter. The exact device-side WebGL error is not available. This is a compatibility mitigation, not a claim of an identified universal driver defect or a physical-device certification.

The old path unconditionally allocated HDR half-float composer targets, PMREM and startup SSAO, even for Balanced. Mobile now starts in Balanced and renders the same scene directly to the canvas, without those targets, post-processing or shadow maps. iPhone/iPad/Android are covered, including iPadOS's desktop Macintosh user agent with multiple touch points. Desktop also falls back if an actual small half-float framebuffer fails its completeness check or the required extension is unavailable. `?graphics=compatible` forces the path for reproducible desktop QA. Physical pixels are capped at 1 megapixel and DPR 1 on this path; quality can still increase geometry detail.

Ultra geometry preparation also supports the direct path: canvas shader compile followed by bounded uploads into a 16×16 RGBA8 scratch target. The original desktop HDR path is retained.

Validation:
- Full suite: 353 tests passed before adding the direct-landmark regression; targeted 13 graphics/warmup tests then passed, including the new direct-path case.
- TypeScript passed.
- Local actual browser rendering: forced-compatible city overview, Robson driving view and first-quarter moon/stars all visible; no browser errors observed.
- 390×844 iframe viewport rendered the city using responsive mobile layout. This exercises CSS viewport and the compatible renderer, **not iOS WebKit or physical phone hardware**.
- No connected physical iPhone/Android browser is available in this session. Device-side confirmation remains outstanding.

Reference: [WebKit's distinction between float and half-float rendering support](https://bugs.webkit.org/show_bug.cgi?id=247240). This supports capability-aware design; it does not prove the reported phone has that specific historical bug.
