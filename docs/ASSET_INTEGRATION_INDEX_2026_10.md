# 2026-10 離線資產整合索引

更新：2026-10-04 UTC。來源需求：[AI_AGENT_DEVELOPMENT_BACKLOG.md](AI_AGENT_DEVELOPMENT_BACKLOG.md)。共同起點 `5574d55719f10d1575127d8b92cbd23ff71e446f`；索引封存：2026-10-04 01:22 UTC；人物、可選駕駛艙與本索引同版交付，精確身份以此檔所在commit及各manifest SHA-256為準；分支 `assets/development-backlog-oct3`；[PR #5](https://github.com/YiTaChen/vancouver-living-atlas/pull/5)。

**本索引交接來源資產，不宣稱城市已採用。全部新候選的 WebGL、正式場景配置、GPU／效能、生命週期及搭乘驗收仍未執行。D06 是未實作的 runtime，且不在本次 asset-only 製作範圍。**

本輪依當前工作樹的 package README／manifest 建立索引，此索引不是驗證報告；實際離線測試證據見各包與交付紀錄。下列離線狀態是包內記錄的範圍，接手者仍須重核 hash 與 validator。早期 [分批交付紀錄](DEVELOPMENT_BACKLOG_DELIVERY_2026_10.md) 是時間序列，不能用其「仍在進行」段落覆蓋後交付的包。原規格和歷史證據沒有改寫。

## 1. 完成狀態怎麼讀

- `offline_complete`：該包明列的來源、匯出、metadata 和離線 QA 完成；不表示同 ID 所有城市工作完成。
- `offline_contract_complete`／`offline_audit_complete`：來源規則、量測或適配契約；**不是新 Blender 模型**。
- `partial`／`provisional`：有可檢查成果，但明列的製作或配合驗證尚未閉合；不可啟用或寫成完成。
- `runtime_pending_webgl`：仍需真正 consumer、來源位置、材質／cache／LOD、碰撞及 WebGL 樣區接合。資料中的 `compatible=true`、預覽、成功 push 或 PR CI 都不等於 `sample_accepted`。
- 目前不能由本索引推論 main merge、Firebase 部署或正式採用。Git commit 身份與實際檔案 hash 各自核對；部分包基準是共同起點的後續分支 commit。

## 2. 全部 20 個新增目錄

下表的路徑均相對 repository root；每包的模型／變體與精確來源、輸出在第 6 節。

| 新包 | 類別與已交內容 | 真正 consumer／接手入口 | 離線狀態與邊界 |
|---|---|---|---|
| [development-backlog](../tools/assets/development-backlog/README.zh-TW.md) | 27-ID 基準庫存、舊 asset／datum／source hashes | `requirements.json`、`inventory.json`、`datum-contracts.json`；映射原 consumer | 庫存完整；零新模型，不能將其原始 planned 快照當本輪最終進度 |
| [package-contract](../tools/assets/package-contract/README.zh-TW.md) | 共通 GLB／來源驗證與 production isolation 工具 | `validate.py`、`verify_isolation.py`；`tests/offline-package-contract.test.mjs` | 工具完成；不代替專用 rig／opening／source-edit／visual QA |
| [city-scale-audit](../tools/assets/city-scale-audit/README.zh-TW.md) | A01–A04 來源規則／CPU ledger | `building-bodies.ts`、`facade-profile.ts`、`building-surface-palette.ts`、`clock.ts`、`atmosphere.ts`、`sky-state.ts`、`sky-effects.ts`、`water-waves.ts`、`bridges.ts`、`railway.ts`、`rail-path.ts`，均在 `lib/city/` | 原包 `partial` 保留；A01/A03/A04 各自 audit 範圍完成，原 A02 coupon 缺口由 ground 包補充；零新模型 |
| [rooftop-equipment](../tools/assets/rooftop-equipment/README.zh-TW.md) | B01 三型 HVAC／兩 LOD；既有壓頂 adapter | `lib/city/architecture-plan.ts`、`lib/city/architecture-details.ts`；`parapet-adapter.json` | `offline_complete`；壓頂轉角／短尾段仍非新成品 |
| [roof-surface-studies](../tools/assets/roof-surface-studies/README.zh-TW.md) | B02 兩材質、2 m／10 m coupon | `lib/city/building-surface-palette.ts`、`building-bodies.ts`、`city-surface-material.ts` | `offline_complete`，僅材質研究與 inspection GLB；不可鋪成屋頂 geometry |
| [mature-tree-templates](../tools/assets/mature-tree-templates/README.zh-TW.md) | B03 四樹種、三 LOD 的 10 m 模板 | `lib/city/detailed-trees.ts`、`assets/tree-geometry.ts`、`assets/tree-structure.ts`、`tree-road-clearance.ts` | `offline_complete`；source-height adapter／alpha coverage／實際 clearance 未接 |
| [landmark-entrance-details](../tools/assets/landmark-entrance-details/README.zh-TW.md) | B04 六種局部、三 LOD | Waterfront：`lib/city/interiors.ts`；Marine：`lib/city/assets/marine-entry.ts`；`assembly-plan.json` | `offline_complete`；不是整棟替換，Marine 不可進入 |
| [facade-fit-contracts](../tools/assets/facade-fit-contracts/README.zh-TW.md) | C01–C03 16 類舊件、Robson sill、兩 bay 的參照契約 | `lib/city/architecture-plan.ts`、`architecture-details.ts`、`architecture-module-candidate.ts`、`facade-profile.ts`、`streetscape-placement.ts`、`streetfronts.ts`、`streetscape-kit.ts` | `offline_contract_complete`；38 份既有 GLB 參照，零新增模型／貼圖 |
| [source-fitted-window-variants](../tools/assets/source-fitted-window-variants/README.zh-TW.md) | C02/C03 新 modern／cedar 框及各自配對窗台，兩 LOD | `lib/city/architecture-module-candidate.ts`、`architecture-plan.ts`、`facade-profile.ts:fitBays/windowBounds`；`fit.mjs` 的 `fitWindow`／`fitAssembly` | `offline_complete`；僅 source-fit 候選，須抑制具名舊 sill 及程序框 |
| [ground-planting-details](../tools/assets/ground-planting-details/README.zh-TW.md) | A02/C04/F03 六表面×2 尺寸 coupon、六局部模型×2 LOD、砂地 master | `lib/city/residential-ground.ts`、`residential-ground-plan.ts`、`road-surfaces.ts`、`material-library.ts`、`beach-ground.ts` | `offline_complete`；coupon／來源 fixture 不是新地形或導航面 |
| [street-furniture-expansion](../tools/assets/street-furniture-expansion/README.zh-TW.md) | F01/F02 八種街道物件、兩 LOD | `lib/city/environment.ts:roadDecorations / lamps`；未接的 source-selected placement adapter；`placement-proposal.json` | `offline_complete`；active placements 空、人口增量 0 |
| [traffic-car-templates](../tools/assets/traffic-car-templates/README.zh-TW.md) | E01 sedan／SUV，各三 LOD | `lib/city/environment.ts:createTraffic/updateTraffic` | `offline_complete`；外觀模型，非可進入車艙 |
| [boardable-bus](../tools/assets/boardable-bus/README.zh-TW.md) | D02 外殼三 LOD＋D03 內裝兩 LOD | `lib/city/city-buses.ts`；manifest `vehicles[]` | `offline_complete`；靜態可登乘接口不等於 D06 |
| [boardable-metro](../tools/assets/boardable-metro/README.zh-TW.md) | D04 lead/middle/tail 外殼三 LOD＋D05 共用內裝兩 LOD | `lib/city/railway.ts` 未啟用的新 profile adapter；manifest `vehicles[]`／`composition` | `offline_complete`；跨車廂移動仍禁止 |
| [transit-station-spaces](../tools/assets/transit-station-spaces/README.zh-TW.md) | D01 五種模塊／兩 LOD、研究站對與 74 m 月台；引用既有 shelter | `lib/city/city-buses.ts`、`railway.ts` 未來 adapter，以及 walk-surface／collision 接口；`station-layout.json` | `offline_complete` 僅研究 layout；真實 stop IDs／地理入口尚缺 |
| [transit-independent-review](../tools/assets/transit-independent-review/README.md) | D01–D05 獨立 hash／幾何／門口／頭部／輪／跨隙板 audit | `audit.py` → `report.json`，非 runtime loader | 離線獨立複核；不擁有模型，不重跑 Blender，不代替完整 rig 或連續碰撞 |
| [driver-independent-review](../tools/assets/driver-independent-review/README.md) | F04／可選駕駛艙的獨立morph、骨架、動畫切換與接觸證據核對 | 獨立audit入口與精確輸入hash，非runtime loader | 獨立audit通過：9組檢查、181個穩定輸入；非第二套碰撞求解器，不算新模型 |
| [material-consumer-candidates](../tools/assets/material-consumer-candidates/README.zh-TW.md) | E02/E04/F05 source-preserving UV／role adapters；兩種 E04 家具；E03 audit | Roadster：`lib/city/assets/roadster.ts`；室內：`lib/city/interiors.ts`；E03：`lib/city/harbour-models.ts`、`assets/aircraft-models.ts`、`assets/cockpits.ts`（控制器原樣保留）；`adapters/consumer-candidates.mjs`、`shared-surfaces.mjs`、`furniture-plan.mjs` | adapters／家具 `offline_complete`；E03 `offline_audit_complete_no_verified_asset_gap`；沒有正式 consumer 替換 |
| [citizen-character-variants](../tools/assets/citizen-character-variants/README.zh-TW.md) | F04 citizen／police／driver／driver-roadster-fit，四家庭×三 LOD | `lib/city/citizen.ts`、`assets/walker.ts`、`traffic-stop.ts`；driver 另需 `assets/roadster.ts`、`navigation.ts`、`driver-camera.ts` | `offline_complete`；citizen／police／natural driver可供受控整合；generic driver是inspection-only拒用研究 |
| [roadster-driver-fit](../tools/assets/roadster-driver-fit/README.zh-TW.md) | E02/F04 可選局部 cockpit＋自然伸腿 driver 配合研究 | `adapters/cockpit-candidate.mjs`，預期接原 Roadster／driver-camera；未啟用 | `offline_complete_static_pose_candidate`；三份來源／GLB及精確自然driver依賴，無正式採用 |

前述 abbreviated consumer 路徑均沿用同格已標明的 `lib/city/` 前綴。未命名成品或 consumer 不因有研究方向就算已交付。

## 3. 27-ID 逐項誠實狀態

所有列的 WebGL 證據都是 `not_run`，正式採用／发布未由本索引確認。除 D06 明列未實作、E03 無新 replacement 外，整合狀態均為 `runtime_pending_webgl`。

| ID | 本輪實際離線成果 | 還留給整合者／尚未完成 |
|---|---|---|
| A01 | city-scale source rules／7,794 accepted parts ledger／CPU audit | 沒有新城市 renderer；保留 32 個來源 height clamp、1,121 個 first-part foundation 排序陷阱 |
| A02 | city-scale 來源量測＋ground 六表面 2/10 m 真 coupon／四光照及 sand master | 補完原 coupon 缺口；真地形、海岸、path／sand consumer 與接地仍待接 |
| A03 | clock／bus／rail／water elapsed-time CPU 契約 | 零新天空、水、霧或極光 shader 優化；不能稱城市畫面改善 |
| A04 | 24 CoV bridge source 路徑／rail CPU continuity audit | 21 OSM bridge acquisition 未重取；未驗明近景缺件，無新橋梁模型 |
| B01 | 三 HVAC／壓頂適配契約 offline_complete | 保留 roofBoxFits／holes／高 part；短尾段／轉角無新模型，2.5 m 高樓首組保留 fallback |
| B02 | 兩 roof surfaces／四 inspection coupons offline_complete | seed mix／roof UV／same-source phase／平均色 fallback 未接；非逐棟材質調查 |
| B03 | 四成熟樹×3 LOD offline_complete | height/10、bark UV、leaf coverage／shadow、LOD/residency 未接 |
| B04 | Waterfront／Marine 六局部×3 LOD offline_complete | 原外殼／玻璃／門／collision 必須保留；其他地標未新增無證據部件 |
| C01 | 8 類既有歷史件／heritage bay／Robson sill 的 fit 契約完整 | 沒有新轉角店面或长短 bay；按實際缺口再做，不能稱完整街段完成 |
| C02 | 現代舊件 fit＋新 source frame/paired sill offline_complete | 具名來源／程序框去重／selected old-sill suppress、真場景 admission 未接 |
| C03 | 住宅舊件 fit＋新 cedar frame/paired sill offline_complete | 保留 ground-datum canopy、入口淨空與上窗；坡地／實例替換未接 |
| C04 | ground curb／edge 與 meter UV／source fit 研究完整 | 地面 contour、rendered triangles、roads／doors 排除、無重複 overlay 接合待做 |
| D01 | 五 station modules／研究站對／74 m platform／disabled threshold decks offline_complete | 真實 stop pair、station footprint、walk/rail attachment 與入口來源未確立 |
| D02 | 中空 bus 外殼／獨立門輪／3 LOD offline_complete | LOD state lock、shared materials、正式 loader／門碰撞未接 |
| D03 | bus 連續 floor、10 席、driver 區、留白／camera／collision primitives offline_complete | pelvis→rig root、乘坐姿勢／相機、moving frame 未接 |
| D04 | metro 首／中／尾3 LOD、四節 metadata offline_complete | route/car pose／門兩段動作／LOD lock 未接；不是 Mark V |
| D05 | 共用 metro interior／12 席／gangway 開洞 offline_complete | 靜態 gangway 存 0.30 m 接縫；moving inter-car traversal 禁止，先單節固定席 |
| D06 | **未實作；資產-only 範圍之外** | 連續服務／停靠／service & passenger state／相機附著／上下車／error recovery 均留待 runtime 開發 |
| E01 | sedan／SUV 三 LOD offline_complete | population／路線不變；更新 ground datum、輪組／LOD／instancing/cache 未接 |
| E02 | Roadster UV／seat/skin/clothing semantic adapter offline_complete | 原車／camera未改；可選cockpit＋自然pose靜態fit完成，camera／動態consumer仍需整合 |
| E03 | 原 harbour／aircraft 實際模型與控制 datum audit 完成 | **無已驗證缺件，新增幾何 0**；保留原模型，不因沒有 .blend 而重製 |
| E04 | 三處室內 UV／role adapter、chair/counter 兩 LOD、58 項 inactive replacement plan 完成 | 54 椅＋4 counter 僅 plan；screens／floor／doors／routes／obstacles 不變；runtime 與近景 seam 待验 |
| F01 | bench／heritage lamp／shelter／獨立8m lamp 兩 LOD offline_complete | source-selected existing slots、接地／通行／glass／diffuser 綁定待接 |
| F02 | bin／hydrant／rack／bollard 兩 LOD offline_complete | 新模型不等於已配置街景；active placements 空，未新增人口 |
| F03 | 中空花台兩種、低植株兩種、soil-grass edge 兩 LOD offline_complete | 只考慮原 bed/plant slots；第一 slope fixture 拒絕、第二幾何 fit 通過都不是已放置 |
| F04 | citizen／police／自然driver離線完成；22骨架／原動畫保留；generic收腿driver是拒用研究 | 自然driver僅相容鎖定hash的可選cockpit；selector／fade／cache／camera／動態乘坐未接 |
| F05 | 8 role IDs／24 maps catalog 與 consumer binding 候選完整，無新 maps | pale-panel 只有 catalog、非新地標 consumer；正式共享載入、UV seam／flipY、四光照未验 |

## 4. 必須先理解的整合契約

### 4.1 單位、datum、來源身份

所有新模型單位為 m。一般作者端 Blender Z-up／−Y front，標準 glTF 一次轉成 Y-up／+Z front，`(x,y,z) → (x,z,−y)`；合法的 glTF axis nodes／skin matrices 不要為了歸零破壞。尺寸是 X寬×Y高×Z深/長，套用檔內 node transform 一次；不要按 bounds 把物件重新置中。

- 建築：HVAC roof-contact Y=0；Waterfront capital 原點是底部，裝配 f+7.825；Marine 使用 `thresholdY−0.16` 一次，仍是封閉觀賞入口。Bay 深度含 canopy，不是可走室內深度。
- 窗框：新框 root=`windowBounds.bottom−sectionM`，modern section=.10、cedar=.07；配對 sill 與框共 root、top Y=−.006、bottom=−.13。新框直接疊舊 sill 已有交疊證據，**必須原子式啟用新 pair 並抑制具名舊 sill 和相應程序框**；失敗／卸載恢復舊件。原住宅 canopy Ymin=2.36、Ymax=3.10 不重設。
- 樹：templateHeightM=10；幾何與 bark UV 倍率皆為 `sourceHeightM/10`，leaf atlas UV 不乘。22.9 m 來源為 2.29 倍。同步縮放 crown/clearance/collision，保留來源位置／seed／數量。
- 物件：地面 Y=0，shelter 保留前柱 root；不要套舊 environment lamp `ground+1`。固定 flower planter 不靠拉伸適配坡面，底部高差門檻 .02 m；bed／road 的真 rendered triangles 仍需整合取樣。
- 車流：根在 tyre contact、前後主軸中點，+Z 前進、−X 右；不要保留舊 traffic body `ground+1.8`／cabin `+0.65`。
- Bus：同一 vehicle root，tyre contact Y=0、軸 Z±3.10；floor/sill .36、ceiling underside 2.60。去除舊 bus `ground+1.08` 補償，完整寬3.04（含鏡）不等於 body2.50或車廂淨寬。
- Metro：rail contact Y=0、bogies Z±5.65；floor/sill .95、ceiling underside3.11。17 m nominal、17.8 m完整單節、71.5 m完整四節分開；car offsets ±26.85/±8.95，74 m研究月台每端餘1.25 m。
- Station：platform +X朝軌道、+Z沿軌道；threshold deck root 在站邊 floor、+X入車，最高面+0.015。stored/deployed 只是已驗靜態姿態，**不等於已設計安全搬移路徑**，`enabled=false` 保留。
- 角色：navigation-owned root、約1.81 m body、22 bones／inverse bind／idle-walk-run 保留。Police 帽高不導致縮小人體；seats 給 pelvis，不是 feet/root。人物 source 是從正式 GLB 重建可編輯資料，無法恢復原 sculpt/bake 歷史，README 已明記。
- E03 是既有程序模型：harbour +Z forward、player aircraft −Z forward；不將一般 glTF 軸規則硬套控制器。Roadster 既有 bounds 負Y wheelwell 也不表示需要重設 datum。

### 4.2 Inspection、材質與記憶體

- Roof 四個 `.inspection.glb`、ground 12 coupons／12 textured prop inspections、material package 的 `qa/roadster.candidate.inspection.glb` 和 `qa/edited-chair.inspection.glb` 都是檢視證據。前兩者不構成屋頂／全城地形；Roadster inspection 也不是替换原程序車的資產。
- Roof：六張256² runtime候選maps共2 MiB RGBA8+mips規劃量；512²原bakes留source。兩表面物理週期2 m，10 m coupon是5×5週期。Inspection GLB各嵌圖，正式consumer按surface ID共用maps，不能每片／每棟另載。
- Trees：一張1024² straight-alpha葉atlas＋三張256² bark，合計6.333 MiB估算；普通GLB不自動載 authored coverage mips。MASK cutoff=.4、color/depth/shadow一致。近景maple/alder `foliage-core` 是 MASK；其他species／LOD仍有OPAQUE內冠，必須按LOD bindings讀。
- Ground：正式小模型role-only零私有maps；inspection資源另外計算，既有 vegetation maps 不代表已正式常駐。Sand三張512²約4 MiB；不自動載整個研究板。Edge U clamp／V repeat；`_GRASS_WEIGHT`低頻頂點值不是pixel weight map。UV已除tileMeters，接要求公尺UV的city shader先乘回一次。
- Furniture／HVAC／windows／cars／transit mostly具名無圖像placeholder；角色宣告不是已綁PBR或已去重。街道家具UV=1 repeat/m；新窗框UV已除metal .8／cedar1.52；不要重複縮放。
- Material adapters：八surface／24張256²maps若全載約8 MiB估算，新增maps為0不代表resident成本0。Roadster paint/rubber/leather週期.5 m，其他1 m；geometry是公尺UV，repeat再處理一次。Native Three flipY=true與glTF模式的texture view分開ownership，不能改一個共用Texture的flipY連帶破壞另一consumer。
- Roadster `leather`原本是driver頭部；只按具名callsite將座墊／椅背／頭枕／側墊綁upholstery。皮膚／衣物／玻璃／screen分開。Interior per-triangle UV可能有grain／normal seams，CPU等距不等於近景接縫已合格。
- Citizen四families共享三張1024²外部map，約16 MiB RGBA8+mips；不要漏傳 `exports/textures/`。舊 roughnessMetallic 圖**不是新ORM契約**：保持G roughness、metallicFactor=0、無occlusion綁定。每actor獨立skeleton/mixer，geometry/material/image cache按content hash及引用計數。
- GLB非image bytes還包含JSON、skin、animation、padding；PNG壓縮bytes不等於decoded texels；primitive數不等於GPU draws。所有GPU memory/FPS仍未量。

### 4.3 LOD、batching 與載入安全

- 資產包的距離門檻均為提案。只換既有 source-selected population；baseline保留、失敗回退，使用generation ticket拒絕late load；最後consumer卸載才dispose共享資源。
- Bus／metro有乘客、門開或上下車時鎖exterior LOD0/1＋interior LOD0/1；LOD2只供空車、門關、不可登乘。Interiors lazy-load，不全城常駐。Metro門先plug再slide，不能closed→open直接斜插值。
- Bus interior7 primitives、metro interior6；station模塊按role合批。原named floor/seat/component nodes是**zero-draw anchors**，真正geometry在batch mesh，須按 `extras.componentRanges`讀實際vertex/index ranges。車門／輪／必要動態nodes不能再次亂merge。
- Metro四車 exterior+interior LOD0/1為178 primitive instances；37個station platform LOD0為111，仍不是WebGL draw或FPS。交通car 11/7/3 primitives；LOD2輪node是Empty，不可宣稱能轉輪。
- E04 chair/counter原檢查版LOD0/1為10/8及7/5 primitives；目前v1.1.0 manifest已更新為每件每LOD **2 primitives**。此export batching已封存於 `22ace3f5`，source-edit／component ownership、7個反例、全部consumer回歸及精確commit CI通過；四份.blend與全部表面三角形保持，GLB合計125,452 bytes。58件replacement plan須先去掉對應舊visual boxes並保留obstacles；2 primitives不代表2個實測GPU draws。
- 角色LOD建議8/20 m、2 m hysteresis、150 ms fade只是研究。玩家／近景driver固定LOD0；保留clip phase／distance，fade color/depth/shadow同coverage。generic收腿driver的integrationEligible=false；自然driver需精確可選cockpit、driver-seated及其DriverGrip權重，不能直接放進原車。

## 5. 後續整合順序與停止條件

1. **鎖定交接版本。** 先在來源分支核每包manifest/source/export/dependency hash和專用validator；reference/audit schema走其自有入口，不把無GLB包送進model validator。重匯出只用README的source-preserving入口、輸出到新目錄，勿跑defaults覆蓋藝術家修改。任何新輸出都不繼承舊QA通過。
2. **建立最小共用載入基礎。** 明確role→surface、metreUV／flipY／alpha、GLB/texture dedup、geometry/actor ownership、failed/late load及dispose，再做來源選定的小樣區。PNG／QA場景／inspection資料不能被bundler自動帶進production。
3. **先靜態外景樣區。** HVAC/roof→一闊葉一針葉→Waterfront/Marine局部；沿來源footprint／sourceID／height／seed，不加任意世界XYZ。每次suppress對應舊visual，保留collision/入口能力。無source-backed gap的A04/E03停止新增模型。
4. **接完整街段但保持數量。** Facade既有fit→新modern/cedar pair→街具→ground局部→traffic sedan/SUV。先提供真實pavement/terrain triangles、來源slot、門/路排除及cell cap，兼容失敗保留fallback。不得把coupon當導航面或新增花草人口。
5. **近景室內與角色分開。** Roadster/interiors先移植窄範圍UV/role候選，不直接把in-memory source loader當production bundler；家具另選named replacements。Citizen/police先QA-only selector。generic收腿driver不供整合；自然driver＋可選cockpit已完成靜態接觸驗證，按精確依賴與clip/morph所有權接入，camera仍需另行明確遷移。
6. **Transit先靜態組装。** 跑獨立review核D01–D05跨包hash；選真實stop/platform來源、合法entry/walk/rail frame，核floor、threshold、door sweeps、rest/deployed deck支持與state gate。先單節固定席，保留gangway禁行。研究IDs不偽裝為現實站點。
7. **D06另開runtime工作。** 明確連續服務path、停靠／門狀態、rider identity／car-local frame、相機、上下車、終點／cancel／dispose／visibility pause／load-fail安全狀態。elapsed time與10:00/300×天鐘分開。模型交付不縮減這張清單，也不在asset-only PR偷做。
8. **有WebGL環境才標sample_accepted。** 固定source/camera/device/quality/revision，同相機clear14h、overcast14h、dusk19.8h、night23h，遠中近／步行／駕車；Transit另验門、座位、移動／上下車／錯誤恢复。記actual canvas、p50/p95、calls/tris、geometry/texture、cache/dispose/context loss；採樣不併跑Blender/build。
9. **正式採用最後處理。** 通過相關回歸、check/test/build及針對新包的production隔離／network檢查，再決定哪些檔進public與正式loader；source-only push／合入不等於部署資產。未解缺口仍明列，不用舊main截圖或舊測試總數補pass。

本輪離線素材與必要研究已封存。新增20個目錄含14個模型／材質來源包及6個庫存／契約／審核工具包；共138份.blend、151份exports GLB（含LOD、inspection coupons及拒用姿勢研究，並非151種可直接放進遊戲的物件）。完整車／手動編輯QA用的4個inspection GLB不重複列為成品。任何來源或adapter更改，都須重新驗證對應hash、相依包與影像；不能沿用本版通過標記。

## 6. 完整模型／變體與 source → export 路徑

各子節先給**完整repository package前綴**；表內為相對該package的精確路徑。`{0,1}`／`{0,1,2}` 是列出的全部LOD檔名，不表示範圍以外也有來源。`inspection`與`source reference`欄不可當成runtime成品。全部`.blend`只用於作者端；瀏覽器不直接載入。

### `tools/assets/rooftop-equipment/`

[Manifest](../tools/assets/rooftop-equipment/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `hvac-compact-single` / compact-single-fan | `source/hvac-compact-single.lod{0,1}.blend` | `exports/hvac-compact-single.lod{0,1}.glb` | 待整合geometry |
| `hvac-medium-twin` / medium-twin-fan | `source/hvac-medium-twin.lod{0,1}.blend` | `exports/hvac-medium-twin.lod{0,1}.glb` | 待整合geometry |
| `hvac-wide-twin` / wide-twin-fan | `source/hvac-wide-twin.lod{0,1}.blend` | `exports/hvac-wide-twin.lod{0,1}.glb` | 待整合geometry |

### `tools/assets/roof-surface-studies/`

[Manifest](../tools/assets/roof-surface-studies/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `roof-mineral-grain-coupon-2m` / 2m-surface-study | `source/roof-mineral-grain.lod0.blend` | `exports/roof-mineral-grain-2m.inspection.glb` | inspection 材質coupon |
| `roof-mineral-grain-coupon-10m` / 10m-surface-study | `source/roof-mineral-grain.lod0.blend` | `exports/roof-mineral-grain-10m.inspection.glb` | inspection 材質coupon |
| `roof-membrane-seams-coupon-2m` / 2m-surface-study | `source/roof-membrane-seams.lod0.blend` | `exports/roof-membrane-seams-2m.inspection.glb` | inspection 材質coupon |
| `roof-membrane-seams-coupon-10m` / 10m-surface-study | `source/roof-membrane-seams.lod0.blend` | `exports/roof-membrane-seams-10m.inspection.glb` | inspection 材質coupon |

兩來源各保存2 m／10 m試片，並非兩LOD。共享候選maps為 `exports/textures/roof-{mineral-grain,membrane-seams}-{color,normal,orm}.png`；512²原始bakes同名位於 `source/textures/`，不作runtime載入。

### `tools/assets/mature-tree-templates/`

[Manifest](../tools/assets/mature-tree-templates/manifest.json) · version `2.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `mature-maple` / maple | `source/mature-maple.lod{0,1,2}.blend` | `exports/mature-maple.lod{0,1,2}.glb` | 待整合geometry |
| `mature-alder` / alder | `source/mature-alder.lod{0,1,2}.blend` | `exports/mature-alder.lod{0,1,2}.glb` | 待整合geometry |
| `mature-douglas-fir` / douglas-fir | `source/mature-douglas-fir.lod{0,1,2}.blend` | `exports/mature-douglas-fir.lod{0,1,2}.glb` | 待整合geometry |
| `mature-western-redcedar` / western-redcedar | `source/mature-western-redcedar.lod{0,1,2}.blend` | `exports/mature-western-redcedar.lod{0,1,2}.glb` | 待整合geometry |

12個GLB共同外部依賴 `exports/textures/bark_basecolor.png`、`bark_normal.png`、`bark_orm.png`、`leaf_atlas_rgba.png`，不漏傳或每instance複製。

### `tools/assets/landmark-entrance-details/`

[Manifest](../tools/assets/landmark-entrance-details/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `waterfront-column` / original-consumer-compatible | `source/waterfront-column.lod{0,1,2}.blend` | `exports/waterfront-column.lod{0,1,2}.glb` | 待整合geometry |
| `waterfront-capital` / original-consumer-compatible | `source/waterfront-capital.lod{0,1,2}.blend` | `exports/waterfront-capital.lod{0,1,2}.glb` | 待整合geometry |
| `waterfront-pediment-moulding` / original-consumer-compatible | `source/waterfront-pediment-moulding.lod{0,1,2}.blend` | `exports/waterfront-pediment-moulding.lod{0,1,2}.glb` | 待整合geometry |
| `waterfront-window-recess` / original-consumer-compatible | `source/waterfront-window-recess.lod{0,1,2}.blend` | `exports/waterfront-window-recess.lod{0,1,2}.glb` | 待整合geometry |
| `marine-archivolt-relief` / original-consumer-compatible | `source/marine-archivolt-relief.lod{0,1,2}.blend` | `exports/marine-archivolt-relief.lod{0,1,2}.glb` | 待整合geometry |
| `marine-copper-grille` / original-consumer-compatible | `source/marine-copper-grille.lod{0,1,2}.blend` | `exports/marine-copper-grille.lod{0,1,2}.glb` | 待整合geometry |

### `tools/assets/source-fitted-window-variants/`

[Manifest](../tools/assets/source-fitted-window-variants/manifest.json) · version `1.1.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `modern-source-window-surround` / modern-recessed | `source/modern-source-window-surround.lod{0,1}.blend` | `exports/modern-source-window-surround.lod{0,1}.glb` | 待整合geometry |
| `cedar-source-window-surround` / residential-cedar | `source/cedar-source-window-surround.lod{0,1}.blend` | `exports/cedar-source-window-surround.lod{0,1}.glb` | 待整合geometry |
| `modern-source-window-paired-sill` / folded-metal | `source/modern-source-window-paired-sill.lod{0,1}.blend` | `exports/modern-source-window-paired-sill.lod{0,1}.glb` | 待整合geometry |
| `cedar-source-window-paired-sill` / sloped-cedar | `source/cedar-source-window-paired-sill.lod{0,1}.blend` | `exports/cedar-source-window-paired-sill.lod{0,1}.glb` | 待整合geometry |

### `tools/assets/ground-planting-details/`

[Manifest](../tools/assets/ground-planting-details/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `curb-straight-1m` / local-reusable-detail | `source/curb-straight-1m.lod{0,1}.blend` | `exports/curb-straight-1m.lod{0,1}.glb` | 待整合geometry |
| `perennial-rosette` / local-reusable-detail | `source/perennial-rosette.lod{0,1}.blend` | `exports/perennial-rosette.lod{0,1}.glb` | 待整合geometry |
| `perennial-tuft` / local-reusable-detail | `source/perennial-tuft.lod{0,1}.blend` | `exports/perennial-tuft.lod{0,1}.glb` | 待整合geometry |
| `planter-round` / local-reusable-detail | `source/planter-round.lod{0,1}.blend` | `exports/planter-round.lod{0,1}.glb` | 待整合geometry |
| `planter-trough` / local-reusable-detail | `source/planter-trough.lod{0,1}.blend` | `exports/planter-trough.lod{0,1}.glb` | 待整合geometry |
| `soil-grass-edge-1m` / local-reusable-detail | `source/soil-grass-edge-1m.lod{0,1}.blend` | `exports/soil-grass-edge-1m.lod{0,1}.glb` | 待整合geometry |
| `surface-asphalt-10m` / representative-offline-study | `source/surface-asphalt-10m.lod0.blend` | `exports/surface-asphalt-10m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-asphalt-2m` / representative-offline-study | `source/surface-asphalt-2m.lod0.blend` | `exports/surface-asphalt-2m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-concrete-10m` / representative-offline-study | `source/surface-concrete-10m.lod0.blend` | `exports/surface-concrete-10m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-concrete-2m` / representative-offline-study | `source/surface-concrete-2m.lod0.blend` | `exports/surface-concrete-2m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-grass-10m` / representative-offline-study | `source/surface-grass-10m.lod0.blend` | `exports/surface-grass-10m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-grass-2m` / representative-offline-study | `source/surface-grass-2m.lod0.blend` | `exports/surface-grass-2m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-sand-10m` / representative-offline-study | `source/surface-sand-10m.lod0.blend` | `exports/surface-sand-10m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-sand-2m` / representative-offline-study | `source/surface-sand-2m.lod0.blend` | `exports/surface-sand-2m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-soil-10m` / representative-offline-study | `source/surface-soil-10m.lod0.blend` | `exports/surface-soil-10m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-soil-2m` / representative-offline-study | `source/surface-soil-2m.lod0.blend` | `exports/surface-soil-2m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-street-brick-10m` / representative-offline-study | `source/surface-street-brick-10m.lod0.blend` | `exports/surface-street-brick-10m.lod0.inspection.glb` | inspection 材質coupon |
| `surface-street-brick-2m` / representative-offline-study | `source/surface-street-brick-2m.lod0.blend` | `exports/surface-street-brick-2m.lod0.inspection.glb` | inspection 材質coupon |

另有可編輯材質 `source/sand-procedural-master.blend`；六個local-model的每個LOD還有 `exports/<asset-id>.lod{0,1}.inspection.glb`，僅檢視。共享檢視／sand maps 在 `exports/textures/`，以manifest的textures與hash為準。

### `tools/assets/street-furniture-expansion/`

[Manifest](../tools/assets/street-furniture-expansion/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `cedar-bench` / cedar-bench | `source/cedar-bench.lod{0,1}.blend` | `exports/cedar-bench.lod{0,1}.glb` | 待整合geometry |
| `heritage-lamp` / heritage-lamp | `source/heritage-lamp.lod{0,1}.blend` | `exports/heritage-lamp.lod{0,1}.glb` | 待整合geometry |
| `transit-shelter` / transit-shelter | `source/transit-shelter.lod{0,1}.blend` | `exports/transit-shelter.lod{0,1}.glb` | 待整合geometry |
| `arterial-lamp-8m` / arterial-lamp-8m | `source/arterial-lamp-8m.lod{0,1}.blend` | `exports/arterial-lamp-8m.lod{0,1}.glb` | 待整合geometry |
| `garbage-bin` / garbage-bin | `source/garbage-bin.lod{0,1}.blend` | `exports/garbage-bin.lod{0,1}.glb` | 待整合geometry |
| `fire-hydrant` / fire-hydrant | `source/fire-hydrant.lod{0,1}.blend` | `exports/fire-hydrant.lod{0,1}.glb` | 待整合geometry |
| `bicycle-rack` / bicycle-rack | `source/bicycle-rack.lod{0,1}.blend` | `exports/bicycle-rack.lod{0,1}.glb` | 待整合geometry |
| `bollard` / bollard | `source/bollard.lod{0,1}.blend` | `exports/bollard.lod{0,1}.glb` | 待整合geometry |

### `tools/assets/material-consumer-candidates/`

[Manifest](../tools/assets/material-consumer-candidates/manifest.json) · version `1.1.0` · recorded status `offline_complete; runtime_pending_webgl`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `lecture-chair-module` / representative-shared-oak | `source/lecture-chair-module.lod{0,1}.blend` | `exports/lecture-chair-module.lod{0,1}.glb` | 待整合geometry |
| `admissions-counter-module` / representative-shared-oak | `source/admissions-counter-module.lod{0,1}.blend` | `exports/admissions-counter-module.lod{0,1}.glb` | 待整合geometry |

另有 `qa/roadster.candidate.inspection.glb`／`qa/edited-chair.inspection.glb`，均為QA-only；前者來自原Roadster constructor候選，沒有宣稱它擁有新的完整車體`.blend`。真正consumer候選為 `adapters/consumer-candidates.mjs`，材質為 `adapters/shared-surfaces.mjs`。

### `tools/assets/traffic-car-templates/`

[Manifest](../tools/assets/traffic-car-templates/manifest.json) · version `1.1.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `traffic-sedan` / sedan | `source/traffic-sedan.lod{0,1,2}.blend` | `exports/traffic-sedan.lod{0,1,2}.glb` | 待整合geometry |
| `traffic-suv` / suv | `source/traffic-suv.lod{0,1,2}.blend` | `exports/traffic-suv.lod{0,1,2}.glb` | 待整合geometry |

### `tools/assets/boardable-bus/`

[Manifest](../tools/assets/boardable-bus/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `city-bus-12m-exterior` / representative-12m-low-floor | `source/city-bus-12m-exterior.lod{0,1,2}.blend` | `exports/city-bus-12m-exterior.lod{0,1,2}.glb` | 待整合geometry |
| `city-bus-12m-interior` / representative-12m-low-floor | `source/city-bus-12m-interior.lod{0,1}.blend` | `exports/city-bus-12m-interior.lod{0,1}.glb` | 待整合geometry |

### `tools/assets/boardable-metro/`

[Manifest](../tools/assets/boardable-metro/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `expo-metro-lead-exterior` / lead | `source/expo-metro-lead-exterior.lod{0,1,2}.blend` | `exports/expo-metro-lead-exterior.lod{0,1,2}.glb` | 待整合geometry |
| `expo-metro-middle-exterior` / middle | `source/expo-metro-middle-exterior.lod{0,1,2}.blend` | `exports/expo-metro-middle-exterior.lod{0,1,2}.glb` | 待整合geometry |
| `expo-metro-tail-exterior` / tail | `source/expo-metro-tail-exterior.lod{0,1,2}.blend` | `exports/expo-metro-tail-exterior.lod{0,1,2}.glb` | 待整合geometry |
| `expo-metro-shared-interior` / shared | `source/expo-metro-shared-interior.lod{0,1}.blend` | `exports/expo-metro-shared-interior.lod{0,1}.glb` | 待整合geometry |

### `tools/assets/transit-station-spaces/`

[Manifest](../tools/assets/transit-station-spaces/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `bus-stop-pole` / representative-research | `source/bus-stop-pole.lod{0,1}.blend` | `exports/bus-stop-pole.lod{0,1}.glb` | 待整合geometry |
| `platform-edge-2m` / representative-research | `source/platform-edge-2m.lod{0,1}.blend` | `exports/platform-edge-2m.lod{0,1}.glb` | 待整合geometry |
| `station-guidance-sign` / representative-research | `source/station-guidance-sign.lod{0,1}.blend` | `exports/station-guidance-sign.lod{0,1}.glb` | 待整合geometry |
| `bus-threshold-deck` / representative-research | `source/bus-threshold-deck.lod{0,1}.blend` | `exports/bus-threshold-deck.lod{0,1}.glb` | 待整合geometry |
| `metro-threshold-deck` / representative-research | `source/metro-threshold-deck.lod{0,1}.blend` | `exports/metro-threshold-deck.lod{0,1}.glb` | 待整合geometry |

### `tools/assets/citizen-character-variants/`

[Manifest](../tools/assets/citizen-character-variants/manifest.json) · version `1.0.0` · recorded status `offline_complete`

| Asset ID／variant | 作者來源 | GLB輸出 | 身份 |
|---|---|---|---|
| `vancouver-citizen` / citizen | `source/citizen.lod{0,1,2}.blend` | `exports/citizen.lod{0,1,2}.glb` | 待整合geometry |
| `vancouver-police` / police | `source/police.lod{0,1,2}.blend` | `exports/police.lod{0,1,2}.glb` | 待整合geometry |
| `vancouver-driver` / driver | `source/driver.lod{0,1,2}.blend` | `exports/driver.lod{0,1,2}.glb` | inspection_only、integrationEligible=false；拒用收腿研究 |
| `vancouver-driver-roadster-fit` / driver-roadster-fit | `source/driver-roadster-fit.lod{0,1,2}.blend` | `exports/driver-roadster-fit.lod{0,1,2}.glb` | offline_complete；僅供精確可選cockpit的受控整合 |

四家庭source來自正式GLB重建，限制見README；必帶 `exports/textures/citizen-53e23506fc52ad56.png`、`citizen-97cbd4395750f8b9.png`、`citizen-d750e70a2bafbdb5.png`。generic driver是拒用研究；自然driver已通過可選cockpit三LOD靜態fit，最大有限取樣手部侵入2.746／2.284／2.295mm（門檻3mm），非連續穿透或人體工學認證。DriverGrip預設0，driver-seated為1，離座必須stop/fade該clip恢復0。

### `tools/assets/roadster-driver-fit/`（已封存的可選局部候選）

本索引只核對到下列工作檔存在；沒有將它們計入任何offline_complete family。最終manifest的命名／hash／dependency chain及驗證仍須以包作者封存為準。

| 工作模型 | 作者來源 | GLB輸出 | 狀態 |
|---|---|---|---|
| roadster-cockpit-local | `source/roadster-cockpit-local.lod{0,1,2}.blend` | `exports/roadster-cockpit-local.lod{0,1,2}.glb` | offline_complete_static_pose_candidate；不是整車重建／正式採用 |

相關 `adapters/cockpit-candidate.mjs` 是未啟用研究入口。自然pose使用相關包 `citizen-character-variants` 的 `driver-roadster-fit`，不能把其中一邊單独視為已驗證可用組合。


### 可選駕駛艙的額外契約

Driver座椅8原始零件只做整體+0.265m Z平移；儀表台駕駛側下緣Y=.85、原方向盤上移.18m、地板在原Y=.475延伸。原外殼、乘客座、輪組、navigation與動力學不改。八個原座椅／門肩接縫的來源三角形交叉被保留並逐一識別，不冒稱原車接縫完全無交叉。靜態椅墊淨距約4.95mm、背衣到椅背法向最小約22.5mm／中位42.9mm；這是剛性視覺近似，沒有軟墊或舒適度驗收。

Ordinary GLB保留作者端normalized／原座椅UV及role-only材質，不應直接貼公尺maps。`materialCandidate=true`的離線組合adapter為15個替換mesh建立公尺UV，八個座椅件獨立seat-leather角色；dashboard／floor／rim／metal維持各自fallback。旧normalized-UV tangents移除後由新chart導數計算基底，防止法線方向錯配。這個adapter仍未移植至正式loader。

### `tools/assets/facade-fit-contracts/`（舊來源參照，不是新增geometry）

下表路徑例外為**完整repository相對路徑**，來源與GLB維持原包位置。精確hash在本包 `manifest.json` 的 `moduleContracts`／`existingVariantReferences`／`bayReferences`。

| 引用ID | 既有作者來源 | 既有GLB | 身份 |
|---|---|---|---|
| `sandstone-sill` | `tools/assets/architecture-details/source/sandstone-sill.lod{0,1}.blend` | `tools/assets/architecture-details/assets/sandstone-sill.lod{0,1}.glb` | source reference；非本輪新製作 |
| `heritage-window-frame` | `tools/assets/architecture-details/source/heritage-window-frame.lod{0,1}.blend` | `tools/assets/architecture-details/assets/heritage-window-frame.lod{0,1}.glb` | source reference；非本輪新製作 |
| `heritage-cornice` | `tools/assets/architecture-details/source/heritage-cornice.lod{0,1}.blend` | `tools/assets/architecture-details/assets/heritage-cornice.lod{0,1}.glb` | source reference；非本輪新製作 |
| `sandstone-plinth` | `tools/assets/architecture-details/source/sandstone-plinth.lod{0,1}.blend` | `tools/assets/architecture-details/assets/sandstone-plinth.lod{0,1}.glb` | source reference；非本輪新製作 |
| `sandstone-corner` | `tools/assets/architecture-details/source/sandstone-corner.lod{0,1}.blend` | `tools/assets/architecture-details/assets/sandstone-corner.lod{0,1}.glb` | source reference；非本輪新製作 |
| `residential-entry-surround` | `tools/assets/architecture-details/source/residential-entry-surround.lod{0,1}.blend` | `tools/assets/architecture-details/assets/residential-entry-surround.lod{0,1}.glb` | source reference；非本輪新製作 |
| `sloped-metal-awning` | `tools/assets/architecture-details/source/sloped-metal-awning.lod{0,1}.blend` | `tools/assets/architecture-details/assets/sloped-metal-awning.lod{0,1}.glb` | source reference；非本輪新製作 |
| `flat-metal-awning` | `tools/assets/architecture-details/source/flat-metal-awning.lod{0,1}.blend` | `tools/assets/architecture-details/assets/flat-metal-awning.lod{0,1}.glb` | source reference；非本輪新製作 |
| `modern-recessed-window-surround` | `tools/assets/architecture-expansion/source/modern-recessed-window-surround.lod{0,1}.blend` | `tools/assets/architecture-expansion/assets/modern-recessed-window-surround.lod{0,1}.glb` | source reference；非本輪新製作 |
| `modern-sill-drip` | `tools/assets/architecture-expansion/source/modern-sill-drip.lod{0,1}.blend` | `tools/assets/architecture-expansion/assets/modern-sill-drip.lod{0,1}.glb` | source reference；非本輪新製作 |
| `modern-parapet-cap` | `tools/assets/architecture-expansion/source/modern-parapet-cap.lod{0,1}.blend` | `tools/assets/architecture-expansion/assets/modern-parapet-cap.lod{0,1}.glb` | source reference；非本輪新製作 |
| `concrete-shadow-plinth` | `tools/assets/architecture-expansion/source/concrete-shadow-plinth.lod{0,1}.blend` | `tools/assets/architecture-expansion/assets/concrete-shadow-plinth.lod{0,1}.glb` | source reference；非本輪新製作 |
| `concrete-chamfer-corner` | `tools/assets/architecture-expansion/source/concrete-chamfer-corner.lod{0,1}.blend` | `tools/assets/architecture-expansion/assets/concrete-chamfer-corner.lod{0,1}.glb` | source reference；非本輪新製作 |
| `residential-cedar-window-surround` | `tools/assets/architecture-expansion/source/residential-cedar-window-surround.lod{0,1}.blend` | `tools/assets/architecture-expansion/assets/residential-cedar-window-surround.lod{0,1}.glb` | source reference；非本輪新製作 |
| `residential-cedar-sill` | `tools/assets/architecture-expansion/source/residential-cedar-sill.lod{0,1}.blend` | `tools/assets/architecture-expansion/assets/residential-cedar-sill.lod{0,1}.glb` | source reference；非本輪新製作 |
| `residential-gabled-entry-canopy` | `tools/assets/architecture-expansion/source/residential-gabled-entry-canopy.lod{0,1}.blend` | `tools/assets/architecture-expansion/assets/residential-gabled-entry-canopy.lod{0,1}.glb` | source reference；非本輪新製作 |
| `robson-sill-blender-candidate-v1` | `tools/assets/architecture-details/runtime-candidate/source/sandstone-sill.lod{0,1}.blend` | `tools/assets/architecture-details/runtime-candidate/assets/sandstone-sill.lod{0,1}.glb` | source reference；非本輪新製作 |
| `heritage-shop-bay` | `tools/assets/streetscape/source/heritage-shop-bay.lod{0,1}.blend` | `public/models/streetscape/heritage-shop-bay.lod{0,1}.glb` | source reference；非本輪新製作 |
| `modern-lobby-bay` | `tools/assets/streetscape/source/modern-lobby-bay.lod{0,1}.blend` | `public/models/streetscape/modern-lobby-bay.lod{0,1}.glb` | source reference；非本輪新製作 |

以上舊GLB有些含檢視用embedded images；依角色綁定原共用city atlas，不因此為每個部件另留一組GPU maps。既有bay已是歷史正式資產，也不代表新fit adapter啟用。

### 無模型包的實際交付路徑

- `tools/assets/development-backlog/`：`requirements.json`、`package-catalog.json`、`datum-contracts.json`、`inventory.json`、`qa/validation.json`。沒有新source/exports。
- `tools/assets/package-contract/`：`validate.py`、`verify_isolation.py`、`test_validate.py`、`test_isolation.py`。沒有模型或source包。
- `tools/assets/city-scale-audit/`：`manifest.json`、`source-rules.json`、`qa/report.json`、`qa/buildings.jsonl`、`qa/source-hashes.json`、`qa/handoff.json`。assets/textures空是正確身份，不製作整城GLB。
- `tools/assets/transit-independent-review/`：`audit.py`、`report.json`、`README.md`。只記錄三transit包的獨立audit，不複製、不另發模型manifest。
- `tools/assets/driver-independent-review/`：`audit.mjs`、`report.json`、`README.md`。9組檢查、181個穩定輸入；完整Git歷史與指定baseline是重跑前提。獨立比較morph→skin→world與Three API、驗證clip退出／fade重設；碰撞則重播已審查的求解器，不假稱第二套獨立碰撞引擎。

## 7. 索引核對界線與後續更新

此次文檔核對包含：新目錄完整性、README／manifest狀態一致性、模型ID及source/export入口、來源與inspection分類、27需求不漏列。檔案存在的檢查不等於內容hash／Blender幾何／視覺驗證重跑。接手者先查看每包 `qa/handoff.json` 與 `qa/validation.json`；無標準QA檔的reference/tool包依README專用report執行。

仍有效的integration blockers：真實D01地理入口未建立、D06完全未實作、metro跨車廂接縫未完成、generic收腿driver明確拒用、自然driver需受控camera／動態整合、所有WebGL/cache/disposal/performance未验。這些不要求asset-only分支擴大runtime scope，也不能由一次來源發布消除。

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0
