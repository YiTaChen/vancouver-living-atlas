# Roadster 全尺寸駕駛座：獨立離線候選 v1.0.0

Based on Vancouver Living Atlas by YiTaChen. Source: https://github.com/YiTaChen/vancouver-living-atlas. License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE).

此包只提供可選擇的本地駕駛艙零件與嚴格來源配接器，不啟用任何 runtime。它與 E02 的幾何不變材質配接器是兩個獨立選擇。原始 Roadster、public、navigation、camera、碰撞與車輛動態檔案均不改寫。

## 精確修改範圍

原車採用米、+Y向上、+Z向前、+X駕駛側；原點與比例完全保留。

- 儀表臺原界限 X[-.785,.785]、Y[.71,.89]、Z[.445,.775]。僅駕駛側 X[.20,.68] 的下方開槽，把該段底面提高到Y=.85；頂面仍是Y=.89，其餘外界限不變。
- 原尺寸方向盤半徑.16、管徑半徑.019、X傾角.25rad保留。輪圈與兩根輻條一同上移.18m；中心從[.44,.88,.40]到[.44,1.06,.40]。
- 駕駛側地板延續塊 X[.20,.68]、Y[.385,.475]、Z[.635,.89]，與原地板端部接合。原地板、底盤與外殼完全不動，沒有降低底盤，也沒有虛構踏板。
- 原駕駛座的坐墊、靠背、頭枕、兩側墊與三條縫線作為同一個剛性組件沿+Z移動.265m。八個原始零件的頂點/三角形保持不變，配接器檢驗重新匯入後與原來源之間的誤差≤1µm。乘客座、rollover hoops與外殼不動。獨立外殼稽核確認沒有新增交叉的來源三角形；原座椅與駕駛側門肩已有的8個裝配交叉三角形仍保留，以原始三角形身分逐一比對，並不宣稱原車該接縫完全無交叉。
- 僅在該可選組裝中抑制舊裝飾駕駛員的軀幹、頭和兩臂，避免雙重人物；真實人物由F04獨立包擁有。

`specs.json`是完整尺寸/抑制計數契約。`qa/adapter-preservation.json`檢查原始碼SHA、精確callsite、所有未抑制的世界三角形、八個座椅剛性零件，以及3組實際輪軸更新；同時檢驗E02材質配接器開啟/關閉兩種組裝、三個LOD。`makeCockpitCandidate({ replacementGlb })`必須明確傳入替換GLB，未提供時拒絕執行；來源SHA或callsite變更也拒絕。

## 人物、接觸與限制

匹配F04的`driver-roadster-fit.lod0/1/2.glb`，不是舊的蜷腿clearance study。人物root=[.44,0,-.06]，quaternion單位，scale=[1,1,1]，播放`driver-seated`在.5秒。站姿身高約1.81m與原inverse binds保持；自然腿長、髖部與腳踝不拉伸。駕駛專用版本移除背包，軀幹輕微後傾8°。`DriverGrip`必須先按實際GLB動畫權重套用，再skin/world transform；不能用站姿POSITION檢查彎曲手部。

`check-fit.mjs --all`對實際變形三角形與儀表臺/中控臺/地板/方向盤/座椅實體執行邊-面交叉、閉合實體內含、三角形最近距離；開放外殼只宣稱表面交叉測試。手部單獨列出：左右手距離輪圈需≤3mm，頂點、邊中點、重心取樣的實體侵入深度需≤3mm。該深度是明確的有限取樣，不冒充連續穿透最大值。變形陰性對照見`test-contact.mjs`，包括先morph後旋轉骨骼的測試。

目前靜態支撐仍是視覺近似。坐墊最近淨距約4.95mm，靠背到後衣面的法向淨距約最小22.5mm/中位42.9mm。最窄側墊/手臂淨距約5.4mm。不存在軟墊壓縮模擬，不能據此認證舒適性、人體工學、操作安全或全動畫淨空。各最終LOD的精確結果以`qa/driver-fit-lod*.json`及`qa/candidate-seat-support.json`為準。

眼部目標由實際臉部網格重新量測，位於各fit報告camera欄。原導航眼點[.45,1.2,0]未移動；日後若採用此駕駛員，camera必須另行明確遷移。沒有entry/exit、轉向動作、踏板、安全帶、WebGL或gameplay驗收。

## 可編輯來源與重新匯出

原始GLB保留藝術家編輯的基本圖元0–1 UV與繼承座椅角度UV。僅明確啟用`materialCandidate:true`時，配接器在記憶體複製幾何/材質、用既有E02 helper產生三角形等距米制UV，並移除舊UV的tangent屬性以使用新chart的導數切線。八個座椅零件設為獨立`seat-upholstery/vehicle-seat-leather`；儀表臺、地板、輪圈與金屬輻條保持獨立fallback角色。`bindCockpitCandidateMaps`使用同一E02共享貼圖組，顏色/ORM通道與0.5m repeat正確，不把皮革綁到儀表臺或方向盤。此新UV是原生Three chart，所以flipY=true；並非重複使用GLB的規範化UV。關閉combined mode時拒絕該綁定API。`qa/material-composition.json`涵蓋三個LOD、UV物理邊長、角色隔離、map identity、shader hook及原GLB不變。

普通GLB，無Draco、GPU實例或自訂runtime擴充；各LOD有15個可獨立編輯節點、2個不含貼圖的PBR材質。座椅的原始支撐形狀在各LOD保持不變，僅輪圈/輻條減面；這不是整輛車的LOD系統。

- 重新匯出既有藝術家編輯：`blender -b -t 2 --python-exit-code 1 --python tools/assets/roadster-driver-fit/export.py -- --source tools/assets/roadster-driver-fit/source/roadster-cockpit-local.lod0.blend --output /tmp/roadster-cockpit-local.lod0.glb`
- 明確重新產生預設才執行：`node tools/assets/roadster-driver-fit/extract-source-seats.mjs`，然後`blender -b -t 2 --python-exit-code 1 --python tools/assets/roadster-driver-fit/build.py`
- 來源不改寫與真實編輯證明：`blender -b -t 2 --python-exit-code 1 --python tools/assets/roadster-driver-fit/audit-blender.py`。它在暫存副本改頂點、UV、材質色/粗糙度，再重開/匯出/匯入驗證；不支援的材質節點明確拒絕。
- `node tools/assets/roadster-driver-fit/audit-adapter.mjs`只檢查；加`--write-fixtures`才重新輸出離線完整/語意inspection GLB。
- `node tools/assets/roadster-driver-fit/test-contact.mjs`；`node tools/assets/roadster-driver-fit/check-fit.mjs --all`；`python tools/assets/roadster-driver-fit/validate.py`；`./node_modules/.bin/oxlint tools/assets/roadster-driver-fit`

`render.py`真實重新匯入GLB、播放同一駕駛動作，以Cycles CPU 2執行緒輸出完整車、側剖、座椅支撐、手部、腳部與四種光照LOD證據。剖面只隱藏QA物件，隱藏清單、輸入SHA及相機用途記錄在`qa/render-evidence.json`；不會改變交付GLB或原車。完整車與語意拆分fixture的三角形相等也由配接器稽核驗證。
