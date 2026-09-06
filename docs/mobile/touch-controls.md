# Touch controls — September 6, 2026

Phone, tablet and narrow-window HUD uses compact tool buttons. The minimap starts collapsed and can remain open alongside the joystick. The former street movement card, always-open camera hints and bottom status bar are hidden. Vehicle and cockpit selection remain in Travel options.

Placement retains the mode bar, map marker, zoom controls and a compact Cancel placement button. The desktop introduction card, coordinates, quick starts and Start here button are hidden on touch layouts. Tap a valid location to commit; map drags continue adjusting the map.

The thumbstick applies an analog vector to the existing navigation update, with a 12% dead zone and circular magnitude clamp. Walking strafes relative to camera heading. Cars and boats retain their existing acceleration, braking/coasting, collision and water physics. A second canvas finger can look independently; a UI pointer release does not reset canvas touch tracking. Pointer cancel, capture loss, blur, hidden tab and component removal clear held input.

Reference for the left movement/right view convention: [Minecraft controls](https://www.minecraft.net/en-us/article/minecraft-controls). No external joystick package or assets were copied.

Validation: TypeScript check, full existing suite plus navigation regression tests for continuous walking, release/reset, strafe direction, vehicle movement, circular dead zone and independent pointer ownership. Browser checks used 390×844, 844×390 and 768×1024 viewports, direct map placement, joystick drag/release, minimap and travel panels. These are browser viewport checks, not a physical iPhone multi-touch certification.
