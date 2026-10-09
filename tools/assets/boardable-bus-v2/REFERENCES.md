# Visual references and approximations

Reviewed 2026-10-09. Both image files below were downloaded for local inspection and opened as actual pixels **before modelling**. Search captions were not used as substitutes for the images. The photos are not bundled, projected, traced into textures, or redistributed in this package.

## Front-half correction: fresh matched-model photographs

Rechecked online on 2026-10-09 and inspected the actual downloaded pixels before correcting geometry. The photographer identifies bus **1210 as a December 2012 West Vancouver Municipal Transit New Flyer XD40**. These are 40-foot rigid Xcelsiors in the same 2012 family as #1202 below, not articulated D60LF floorplans.

- [WVMT 1210, front entrance looking aft](https://www.flickr.com/photos/thetransitcamera/36077892202), TheTransitCamera / J. Mc. Inspected image SHA-256 `2929fb84e40b048bd4204df1260fc8bc72247ac0f45e16bcb461920b29f2ccd4`.
- [WVMT 1210, rear looking toward front](https://www.flickr.com/photos/thetransitcamera/35439742583), same photographer. Inspected image SHA-256 `b453f0fa1530d8dcd8e9894e602912d41515b4c70421c4f84ee3419374174e68`.
- [WVMT 1202, driver cockpit closeup](https://www.flickr.com/photos/chsscassidy/8184218228/), Chris Cassidy. Inspected image SHA-256 `fe6db0581a33057dded2362d87ebd8a275fe63915b394be98c61e5bb5cde2d41`.

Observed topology: cab on the vehicle's left and front entrance on the right; separate black driver suspension seat, steering pedestal, sculpted low dash and long side console; tall grey cabinet/partition aft of the driver; a bare metal-topped passenger-side front wheelhouse with yellow guardrail; open low-floor mobility space with longitudinal folding seats along the walls; forward pairs farther aft; rear steps and forward rear rows. The exact photos show movable seats in different stowed/deployed states, not a universal single seating capacity.

The correction uses three deployed inward-facing priority seats on the left, three visibly stowed places on the right, and four forward low-floor seats farther aft. This represents one authored static configuration. Stowed seats have no passenger anchors and cannot be simultaneously counted as active seats and clear wheelchair space. Neither folding animation nor regulatory accessibility is claimed. The rear 17 seats and all 526 original geometry components wholly aft of Z=-1.45 m across both LODs have exact unchanged ordered world-space vertex hashes. Rear upholstery changes color at the user's request; its geometry does not.

The user's attached image was **our earlier generated preview**, not a real photograph. Its SHA-256 is `2b8ebfc20630736bc0ba2b7c5994856dbcec0a45ea8a1c2ba4ed08c9d1ab9351`; it was used only for version comparison. No literal mirrored rear mesh was found in the old build. The actual defect was repeated forward-pair seating and regularly repeated rails in a front area that needed distinct cab, wheelhouse and mobility-bay topology. It is not evidence for a real-bus layout.

The inspected photos have reserved rights and are kept research-only. No source-photo pixels or user-supplied earlier preview are bundled or used as textures.

## Earlier photos viewed

1. **TransLink New Flyer Xcelsior interior**, linked by [Daily Hive, “TransLink’s newest buses begin to arrive”](https://dailyhive.com/vancouver/translinks-newest-buses-begin-to-arrive). [Exact inspected image](https://farm9.staticflickr.com/8477/8184216978_69790e83de_z.jpg), 640 × 427 pixels, SHA-256 `cd1450680b465eb47ccc8d3a962f1dad6b9a48486b0fb6b3e7fd29c7c5ff6a36`.
   - Observed in the pixels: paired blue molded seats with separate pads and metal back handles; yellow bent stanchions; hanging hand straps; grey central floor; side wheelchair/priority area; a raised rear reached by yellow-edged steps; roof hatches and long ceiling fixtures.
   - This informed the main visual vocabulary. The article page returned HTTP 403 on a subsequent text fetch; the direct image was downloaded and visually inspected successfully. No reuse license was established for this image, and none of its pixels are distributed.

2. **Arnold C / Buchanan-Hermit, New Flyer D60LF interior, Vancouver**, dated 20 July 2006 on [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Translink-newflyerd60lf-interior.jpg). [Exact inspected original](https://upload.wikimedia.org/wikipedia/commons/2/23/Translink-newflyerd60lf-interior.jpg), 2272 × 1704 pixels, SHA-256 `899146909fa5919444f19d4fca62b64a866afeaf1b516f3c479f7fee0798eb9c`.
   - Observed in the pixels: yellow vertical poles, silver overhead metal rails, blue seating, pale side/roof panels, dark window seals, stop cord along the side, ad panels, and narrow longitudinal aisle.
   - Commons identifies the photographer and a public-domain dedication. This is an **articulated** bus, used only as a secondary material/detail reference. Its articulation, total length, seat count and arrangement were not copied into the representative 12 m model.

## Primary-source context

- [New Flyer’s 18 July 2012 TransLink order announcement](https://www.newflyer.com/2012/07/south-coast-british-columbia-transportation-authority-translink-renews-partnership-with-new-flyer-for-transit-buses/) distinguishes 40-foot XD40 and 60-foot XDE60 variants. It is context for the visual family, not a dimensional drawing or a seat-layout specification.
- [TransLink’s 2 January 2015 CNG bus introduction](https://buzzer.translink.ca/2015/01/take-transit-in-port-coquitlam-you-might-have-spotted-our-new-cng-buses/) describes a higher roof and additional courtesy screens in that particular order. That variant is **not** claimed to be reproduced here.

## What is deliberately approximate

- This is an original project asset, not a branded or surveyed fleet replica. The roof, nominal body envelope, 6.2 m axle spacing, 0.36 m door sill and both door locations remain those of the existing `boardable-bus` package.
- **24 passenger seats are the actual authored count**, not a claim about the photo or a TransLink vehicle’s official capacity: 12 rear paired seats, 5 rear-bench places, 4 lower-floor forward seats and 3 inward priority seats. The driver’s chair is separate. The right wheelchair bay has 3 visibly stowed flip-up places, excluded from the active passenger count.
- Rear deck height 0.68 m, two 0.16 m rises, 0.42 m seat width, 0.45 m seat height above local floor, pole positions and wheelchair bay dimensions are modelling choices checked against the resulting geometry. They are not manufacturer, accessibility or regulatory measurements.
- The old 2.60 m ceiling leaves only 1.92 m over the raised rear. The contract therefore treats the rear as seated-only and excludes it from consumer-facing standing regions. A 1.95 m character can enter and stand in the low-floor area; rear standing for that height is rejected. Runtime seat assignment and route gating remain pending.
- Logos, advertising copy, route text, phototextures, upholstery patterns and real fare hardware are omitted. Blank ad panels and a simplified fare reader are deliberate.
- The ordinary GLBs contain no new light nodes, emissive material or night feature. Ceiling strips are non-emissive daytime geometry. Render lights are external QA daylight only.

## Project provenance

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0

The authorized project reconstruction reuses the project’s metre-space primitive helpers, original exterior, established manifest vocabulary and lossless static-batching implementation. All new interior shapes are editable geometry. This is a newly reconstructed supplement, **not** a byte-identical recovery of unavailable prior work.

## Bus upholstery correction

The user requested deeper bus cushion color. The `seat` PBR base color changed from linear RGBA `(0.018, 0.140, 0.400, 1)` to `(0.010, 0.033, 0.073, 1)`, and roughness from 0.52 to 0.78. The shell changed to `(0.028, 0.065, 0.105, 1)`. Fresh #1210 photos show a dark, somewhat desaturated navy upholstery under variable daylight; these chosen PBR values are an artistic match, not calibrated colorimetry. QA uses AgX at exposure 0 with unchanged daylight world/window-light power. No SkyTrain palette is copied or modified.
