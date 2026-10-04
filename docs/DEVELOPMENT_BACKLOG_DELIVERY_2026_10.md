# 2026-10-03 AI backlog 分批離線交付

來源規格：[AI_AGENT_DEVELOPMENT_BACKLOG.md](AI_AGENT_DEVELOPMENT_BACKLOG.md)。製作基準為 main `5574d55719f10d1575127d8b92cbd23ff71e446f`，不是先前資產批次的舊分支。此輪按規格的製作／整合分工執行：交付可編輯來源、普通 GLB、metadata、離線證據；尚未驗收的內容不進正式載入預設。

追蹤分支：`assets/development-backlog-oct3`；[draft PR #5](https://github.com/YiTaChen/vancouver-living-atlas/pull/5)。每個模型包在完成 package-specific Blender／CPU 檢查後才回填製作完成。共同工具或來源盤點完成不代表 27 項全部完成。

## 已完成的驗證基礎

[package-contract](../tools/assets/package-contract/README.zh-TW.md) 為新的 schema 1 包提供 read-only GLB 與檔案驗證：

- 來源／匯出 SHA-256、實際 geometry 成本、scene-node transform 後 bounds；不把作者端尺寸或 accessor min/max 當成已套用完整 transform 的尺寸。
- 17 個 GLB 正／反例與 2 個正式輸出隔離測試；`npm test` 自動執行 common regression，並驗證符合新契約的包。舊 schema 保持各自的 validator。
- 每包另有 Blender source／reexport／材質／datum／淨空／預覽的獨立驗證。common pass 不取代那些檢查。
- 正式輸出隔離 helper 比對新資產的實際 SHA-256 與 URL 名稱；不假稱做過瀏覽器 network 或 GPU 驗收。

基礎提交 `8b95f013297597845d542463d6ce635105a95c4f` 已通過 [GitHub CI](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37155216117)。

## 驗證邊界

最新已發布 HEAD `22ace3f5da271bf168d5abcbe80dbec184ddef02`（含材質／傢具及可執行CPU回歸）已通過 [CI run 37165942769](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37165942769)。前四批 ground／windows／station／獨立交通審核 `ea8f045d` 亦通過 [CI run 37165357603](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37165357603)。連續分批push取消的較早runs未算通過。詳細模型與接手順序見 [資產整合索引](ASSET_INTEGRATION_INDEX_2026_10.md)。

基準版本本機 `npm run check`、660/660 `npm test`、`npm run build:firebase` 與 landmark worker verifier 通過。既有 `npm run lint` 失敗，涵蓋原有 runtime／tests／tools 診斷；本離線分支不夾帶不相關的全庫 lint 重寫。新增測試／資產的最終結果依各批記錄，不沿用基準數字冒充新結果。

沒有在此環境完成 WebGL 場景、frame-time、GPU 記憶體、玩法或正式載入驗收。先前 main 文件的 GPU 結果只屬先前版本；此輪不重新宣稱它們是新資產的結果。後續整合者須核 source identity、datum、shared roles、LOD／cache／resource disposal、場景配置與實際畫面。

## 第一批可用離線包

| ID | 包與來源提交 | 製作狀態／實際證據 | 後續狀態 |
| --- | --- | --- | --- |
| 共通庫存 | [development-backlog](../tools/assets/development-backlog/README.zh-TW.md)，`58bcb8e3` | 27 ID、436 檔案指紋、63 GLB 容器、16 datum／語意契約；15 個測試 | 基準盤點，不算新模型或 runtime 完成 |
| B01 | [rooftop-equipment](../tools/assets/rooftop-equipment/README.zh-TW.md)，`ad1c849b` | `offline_complete`；3 種機組，6 個 .blend／6 GLB；LOD0 324／388／388 tris，LOD1 70／92／92；零圖像貼圖、每件2 primitives；48 次實際 GLB CPU 渲染、22 測試及手動編輯保留證據 | `runtime_pending_webgl`；屋頂 fitting／排除／shared-role／樣區消費器另驗收 |
| B02 | [roof-surface-studies](../tools/assets/roof-surface-studies/README.zh-TW.md)，`5e173f5a` | `offline_complete`；2 份可編輯材料來源、4 inspection GLB、10 CPU 預覽；真512px來源bake、六張256px共享候選maps合計2MiB規劃估算；8 測試及修改／重烘焙證據 | `runtime_pending_webgl`；256px極近拍柔化、取樣週期與城市平均明度需樣區驗收 |

B01/B02 來源已在 PR5 分支，不表示 main 或 Firebase 已採用。B02 inspection GLB 內嵌 maps 只是方便離線查看，正式整合要綁同一 surface cache；不能直接把四個 GLB 的私有貼圖都載入城市。

## 城市來源、立面接口與第二批 Blender 包

| ID | 包與來源提交 | 本批完成的範圍 | 尚未完成 |
| --- | --- | --- | --- |
| A01／A03／A04 | [city-scale-audit](../tools/assets/city-scale-audit/README.zh-TW.md)，`6081b2c8` | 來源規則與實際 CPU 對照；7,630 solids、7,794 accepted parts ledger、時鐘與交通／水面時間分離、24 條 CoV 橋面來源路徑證據，12 測試 | 不等同 renderer／新橋件／WebGL 優化；21 OSM 橋段只有既有provenance，缺原始acquisition對照 |
| A02 | 同上及下列 ground-planting-details | 既有地表來源量測＋2m／10m專用材質試片完成 | `runtime_pending_webgl`；真實地表consumer未啟用，不能把小坡面鋪成城市 |
| B03 | [mature-tree-templates](../tools/assets/mature-tree-templates/README.zh-TW.md)，`752cd68b` | `offline_complete`；4樹種×3LOD，12份真.blend和12GLB；10m模板，冠幅4.67–4.78m；近景闊葉改為分層masked葉簇；候選全部唯一maps6.333MiB估算 | `runtime_pending_webgl`；尺寸及bark UV倍率都為sourceHeightM/10，leaf atlas UV不動；普通GLB沒有載入authored coverage mips，透明overdraw／LOD變化仍需實測 |
| B04 | [landmark-entrance-details](../tools/assets/landmark-entrance-details/README.zh-TW.md)，`998d4a21` | `offline_complete`；6類×3LOD，18份.blend／18GLB，44張CPU預覽；Waterfront組裝7380/1800/264tris，Marine1916/868/348tris；15測試 | `runtime_pending_webgl`；Marine仍為封閉觀賞凹入，沒有新增可進入能力 |
| C01–C03 | [facade-fit-contracts](../tools/assets/facade-fit-contracts/README.zh-TW.md)，`6081b2c8` | `offline_contract_complete`；參照16類既有件、38GLB；1200 opening rays、48包測試和25既有consumer回歸；重播88個source-selected sill fit | `runtime_pending_webgl`；既有框不適配的兩個實際窗洞已另做source-fitted-window-variants及配對sill（`e2ec16a0`）；明確抑制對應舊sill後才可組裝，不代表整段立面已升級 |

對32個低於2m的來源solid既有clamp，以及1121個building foundation受part排序影響的案例，audit保留精確來源ID與差值，沒有為讓測試通過而擅自改動GIS或碰撞。

驗證器曾把無GLB的source-audit schema誤送進model validator，CI因此失敗一次；`8d07c4cd` 已改成明確schema分流，執行真正的city-source及facade-fit審核，沒有放寬GLB檢查。該修正與B03最終版本的[精確HEAD CI](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37160159829)均已成功。

## 後續批次與整合邊界（持續更新）

- A02／C04／F03：[ground-planting-details](../tools/assets/ground-planting-details/README.zh-TW.md) 已交付，commit `d73224de`。18資產、25份來源、36 GLB，含2m／10m試片與六種接界／小植栽物件；22測試及32 CPU預覽。貼圖試片僅供inspection，不可直接鋪城市；實際放置保持原500 plots／1954 plants。
- D01–D05：公車 `c9d184a4`、metro `67860e17`、站台／跨隙板 `258c48ae` 已交付。研究layout不假冒真實站點；正式地理連接、上下車／moving frame仍待整合。完整清單見下。
- D06：由WebGL整合者開發並驗收停靠／上下車／乘坐流程；資產包完成不代表搭乘功能完成。
- E01：車流來源已交付 `aef5e31d`，兩車型×三LOD，static batching後11／7／3 primitives；6份來源／6GLB，零新maps。F01／F02已交付，見下。
- E02／E04／F05：[material-consumer-candidates](../tools/assets/material-consumer-candidates/README.zh-TW.md) 已交付 `22ace3f5`；Roadster／室內UV和材質角色、58個來源傢具fit與靜態batching通過CPU回歸；正式材質consumer尚未啟用。F04市民／警員／自然driver與可選局部cockpit的離線交付已完成；generic收腿driver是拒用inspection研究。靜態fit不當成舒適度、動態或camera驗收。
- E03：已量測49個harbour variants及兩種玩家航空／cockpit，未驗證到具名缺件，所以沒有以『不是.blend』為由重建有效曲面／動力學。來源audit完成，近景runtime視覺仍未驗收。

本清單逐批更新。所有尚未完成或未測項目保持可見，沒有把來源包推到GitHub等同完成main部署或城市runtime採用。

## F01／F02 街道傢具交付

[street-furniture-expansion](../tools/assets/street-furniture-expansion/README.zh-TW.md)，來源commit `6d9e05c0`：8類傢具（長椅、歷史燈、獨立8m幹道路燈、候車亭、垃圾桶、消防栓、自行車架、防撞柱），16份可編輯.blend與16GLB，共781,256 GLB bytes、零圖像maps。尺寸、LOD、淨空、source保留、13個placement fixtures及12個反例測試通過；88次真正GLB重匯入CPU渲染編成16張審查圖。

此批 `offline_complete / runtime_pending_webgl`。原長椅腿距地面約3cm，新增可編輯接地鞋而不移動0.48m座面；保留4.49m歷史燈和4.56×2.82×1.86m亭外框。代表性位置提案未啟用任何世界實例，diffuser角色也沒有自帶point light。來源[精確HEAD CI](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37160963678)成功。


## 交通／窗框／材質後續批次摘要

- 公車：5份來源與5GLB，車殼2310／1730／208 tris、內裝3760／888；兩LOD內裝各7 primitives。10回歸、真中空門洞、座席與靜態開關門／輪節點契約。`c9d184a4`。
- Metro：11份來源與11GLB，lead／middle／tail各三LOD、共用兩LOD內裝；17m名義車型、17.8m含coupler、四節71.5m。單節內裝6 primitives；四節LOD0外殼＋內裝178，非實測GPU draws。`67860e17`。
- 站台：5種／兩LOD，74×4m研究月台、站牌／導引牌、bus／rail跨隙板；10GLB共267,052 bytes。平台由32降至3 primitives，37件111次提交估算，未量GPU。`258c48ae`。
- 獨立交通審核：123個當前輸入hash，11,560 doorway rays、92座席／頭部檢查、32收板接地case、1536部署板表面rays；先前懸空已修正。真實地理入口、板動作與D06仍待整合。`ea8f045d`。
- 兩種source-fit框／兩種配對sill：8份.blend／8GLB，65,264 bytes、零maps；49 fit／assembly測試＋25幾何反例、48 CPU預覽。抑制具名舊sill才能接受新組裝，不疊加穿模。`e2ec16a0`。
- 材質／室內傢具：保留Roadster14662 triangles與室內16422個floor／walk／drive查詢結果；8既有surface／24maps仍需消費器cache。椅／櫃台各兩LOD共4GLB、125,452 bytes，每件2 primitives；54椅＋4櫃的LOD0提交估算568→116，LOD1 452→116。可編輯來源與全部三角形保持；24張真GLB視角／四光照，7 batching反例＋11 consumer回歸＋8單元＋8既有回歸。`22ace3f5`。

這些來源包仍未合併main、未部署Firebase、未啟用runtime。本次沒有更動原production assets、runtime或workflow。


## 最終人物／可選駕駛艙交付

與本文件同版交付：

- [citizen-character-variants](../tools/assets/citizen-character-variants/README.zh-TW.md)：12份可編輯來源／12GLB，4 families×3LOD。Citizen37735／31767／29931tris；Police38483／32515／30679；自然Driver36417／30449／28613。原22骨架、bit-exact inverse binds與idle/walk/run保留；每份可編輯來源保留其作者幾何；輸出清理階段只剔除64個確切零面積三角形（192 indices）。57CPU＋48包裝／證據檢查、12重匯出與38實際CPU預覽通過。三個共用1024²PNG要一起交付，不能只傳GLB。
- Generic driver是被拒用的收腿研究，integrationEligible=false；不是可選正式駕駛。Natural driver另移除背包、輕微後仰並加入seated-only DriverGrip，必須使用精確鎖定的可選cockpit。所有預設production人物不變。
- [roadster-driver-fit](../tools/assets/roadster-driver-fit/README.zh-TW.md)：3份.blend／3LOD GLB，原driver座椅8件只做+0.265m Z剛性平移，dashboard局部下緣、方向盤+0.18m及腳部支撐pan為可選研究。原外殼、輪／動力／passenger seat／navigation／camera保持；8個原本存在的座椅／門肩裝配交叉逐一識別，不冒稱原車完全無交叉。12幾何反例、6模式／LOD保存檢查、3LOD材質組合、9 CPU預覽完成。
- 全身／座椅／dashboard／floor／輪圈／殼面靜態檢查三LOD通過。最大有限取樣手部侵入2.746／2.284／2.295mm，小於未放寬的3mm門檻；不是連續穿透深度保證。椅墊約4.95mm、背衣到椅背法向最小22.5mm／中位42.9mm的間隙透明保留，不宣稱真實軟墊支撐或人體工學認證。
- [driver-independent-review](../tools/assets/driver-independent-review/README.md)：9組獨立核對、181個穩定輸入hash；morph→skin→world與Three實際API全頂點一致，stop／fade回gait使DriverGrip恢復0，12個來源／輸出／分組proof及38+9渲染hash一致。碰撞部分是重播已審查的求解器，不是假稱第二套獨立碰撞引擎。

## 最終離線驗證與剩餘整合

本版工作樹完成TypeScript檢查、681/681完整npm test、Firebase靜態build與emitted landmark worker verifier。新JS／測試範圍oxlint通過，原基準整庫lint問題仍存在，未藉素材製作重寫無關runtime。所有14模型／材料來源包的實際payload hash／URL名稱都不在72個production dist檔內；這不是browser network觀察。436個舊來源檔仍與原baseline一致。

完整[資產整合索引](ASSET_INTEGRATION_INDEX_2026_10.md)列20目錄、27需求ID、138份.blend及151份含LOD／inspection的export GLB；不是151個獨立可用場景物件。每個模型、物件、人物都有來源與export路徑、consumer／datum／材質／LOD／相依性說明。

本版精確提交的遠端結果請看[PR5 Checks](https://github.com/YiTaChen/vancouver-living-atlas/pull/5/checks)，上方已通過checkpoint供追溯。Source-only交付不啟用城市資產。D01真實地理入口、D06搭乘runtime、camera遷移、動態／WebGL／GPU／LOD快取與disposal仍由後續整合驗收，沒有偽造已完成main或Firebase採用。
