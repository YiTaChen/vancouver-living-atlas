# Blender 素材驗證與城市整合紀錄（2026-10）

來源：`assets/development-backlog-oct3`，交付 commit `dc6e6b5dd14ed83b1909e677d611d8c2eba3b559`，[來源 PR #5](https://github.com/YiTaChen/vancouver-living-atlas/pull/5)。共同城市基準為 `5574d55719f10d1575127d8b92cbd23ff71e446f`。

這份文件記錄接手 agent 的驗證、正式 consumer、成本及剩餘需求。原始製作證據保留於各 package；[交付索引](ASSET_INTEGRATION_INDEX_2026_10.md) 是離線製作狀態，[待開發規格](AI_AGENT_DEVELOPMENT_BACKLOG.md) 是完整需求，兩者不因新素材存在而自動全部完成。

## 交付清點與採用範圍

這批新增 20 個目錄，包括 14 個模型／材質包和 6 個庫存、契約與審核工具包。138 份 `.blend`、151 份 exports GLB 包含 LOD、inspection coupons、拒用姿勢研究；不能解讀為 151 種已進入城市的物件。

| 套件／需求 | 本輪處理 | 保留的界線／下一步 |
| --- | --- | --- |
| rooftop-equipment／B01 | 三型、六個 LOD 接入來源屋頂設備群；完整群替換、失敗回退 | 高樓原 2.5 m 首組保留；壓頂短尾／轉角不是本輪新模型 |
| mature-tree-templates／B03 | 兩闊葉樹種 LOD0 供 Ultra 近景有界 pool；保留來源座標、樹高、種子、總數 | 新針葉樹近景的不透明層片更明顯，WebGL 拒用；中遠景與針葉維持原 consumer |
| traffic-car-templates／E01 | 轎車／SUV 三 LOD 接入現有一般車流；材質合批、輪軸、坡面接地 | 沿用既有路線、速度與數量；不是可搭乘車艙 |
| roof-surface-studies／B02 | 重核離線材質與實際 coupon；供本機 WebGL inspection | 共享 roof surface shader、實際 roof UV／phase、近遠景平均色仍需接合；coupon 不能鋪成屋頂 |
| landmark-entrance-details／B04 | 重核六種局部、尺寸與模型；本機 inspection 入口 | 下一步按 Waterfront／Marine 原組裝契約替換具名零件；不能增加 Marine 入口能力 |
| source-fitted-window-variants／C02/C03 | 實際 GLB／開口／paired sill／現行 GIS fit 回放 | 必須同時 suppress 原框與指定舊窗台；不疊加兩套模型 |
| ground-planting-details／A02/C04/F03 | 重核表面、曲線、UV、植物與地面來源契約 | 需真實 pavement／terrain triangles 接入；保留 500 plots、1,954 plants，不能新增人口或拿 coupon 作導航面 |
| street-furniture-expansion／F01/F02 | 重核八物件、接地、淨空、來源提案；本機 inspection | active placements 仍空；需具名 existing slot、足夠人行道及門／路排除，再替換既有物件 |
| boardable-bus／D02/D03 | 外殼、門、輪、內裝、座位／floor 等離線資料保存與核對 | 未替換行駛公車。直接載入約 21 primitives 的中空外殼會提高成本、暴露未載內装；須先分門輪合批、內裝 lazy-load、服務與乘客狀態 |
| boardable-metro／D04/D05 | 首／中／尾、共用內裝、coupler／gangway 與動畫契約保存 | 未替換正式列車。約 39 primitives／車、四節及透明面須另外預算；門先 plug 再 slide，不能把研究模型當現有列車 service |
| transit-station-spaces／D01 | 研究月台、站牌、引導、threshold decks 及獨立檢查保存 | research IDs 不是實際站點；跨隙板 disabled，未驗證連續部署路徑，不供上下車 |
| material-consumer-candidates／E02/E04/F05 | CPU 語意 adapter 與 54 椅＋4 counters 具名替換計畫保存 | 需移植窄範圍 UV／surface adapter、移除舊 visual；`leather` 舊角色含人頭，不能一鍵改成座椅材質 |
| citizen-character-variants／F04 | rig、動畫、LOD、skin bind 與來源核對；citizen/police inspection 可選 | 新 citizen LOD0 主要去除 64 個退化三角形；不為極小差異取代既有已採用角色。generic driver 明確拒用 |
| roadster-driver-fit／E02/F04 | 可選 cockpit／自然伸腿 driver 的精確相依與接觸資料保存 | 必須成對接入、另遷移相機與動態骨架；靜態接觸合格不等於駕車驗收 |

A01–A04、facade-fit、transit-independent-review、driver-independent-review 等為來源／幾何契約或審核工具，不另外宣稱新城市模型。A04／E03 沒有已證實缺件，保留既有橋梁、港灣與航空模型。D06 搭乘 runtime 仍是獨立待開發工作。

## 正式 consumer 與效益

### 屋頂設備

- 六份原交付 GLB，總 **149,912 bytes**，零新增 maps。
- 以原 `ArchitectureRoofUnit` 的來源位置、yaw、checked footprint 選型；必須找到完整 6–7 個舊 boxes 才替換，截斷群保留 fallback。
- 最多兩個 active cells，全體總上限 High 24／Ultra 48 組；以相機至 cell bounds 距離判斷 550 m 載入範圍及 80 m LOD0 門檻，15 m hysteresis。cell 內共用 LOD，不是逐機組的距離判斷。
- 同 role 使用現有城市金屬 atlas。風扇、外殼與結構有真正幾何，不另增一組私人貼圖。
- 不改建築 GIS、屋頂排除、高樓首組、導航與飛行 envelope。

### 成年樹

- 正式複製兩份闊葉 LOD0，總 geometry GLB **1,557,564 bytes**，四張共用 PNG 保留來源 bytes。
- 作者模板高 10 m；geometry 一次正規化至 1 m，instance matrix 使用來源 `h`，等價於原模板乘 `h/10`。22.9 m 來源仍高 22.9 m。
- bark UV 在 shader 乘來源 `h/10`，葉 atlas UV 不改。bark normal／ORM 為 linear，albedo／leaf 為 sRGB；glTF `flipY=false`。
- 闊葉 LOD0 core 與外葉共用 straight RGBA MASK；新針葉的 opaque core 不採用；正式針葉保持原版。color／shadow 使用同張 map、相同 cutoff 0.4。
- 45 m 範圍內僅 **Ultra 最多 8** 棵新近景闊葉樹；High／Balanced 不載入新樹資產；其餘保持原樹。兩種闊葉最多四個 instanced material batches，不逐棵產生 GLTF scene。
- 四 maps 完整 RGBA8 mip-chain 約 **6.333 MiB**；這是新增貼圖估計，不是實測 VRAM，也不扣除仍保留的舊材質。
- 正式首次 High／Balanced 不載這組資產；進入 Ultra 且 45 m 內有闊葉來源才載入。曾載入後切回 High，替代實例歸零並恢復原模型，共用資產 cache 留至 engine dispose。
- 新樹改善巨型葉片比例與分枝層級，但增加近景三角形／alpha overlap；不宣稱寫實掃描或 FPS 提升。

### 一般車流

- 六份原 GLB，總 **453,244 bytes**，零新增 maps。
- 將 paint／glass／rubber 合為每 model/LOD 三個 batches，保留原 RGBA 車燈、窗、輪胎等顏色。
- 車輪頂點保存原 pivot；使用 per-instance travel 動畫旋轉，不把四輪各自增加成 draw。
- 近／中景按實際 asphalt 的前後及左右採樣求車身平面；車輪接地，不沿用舊方塊中心的任意高度。
- 近景最多 64 車、中景 192 車，其餘使用遠 LOD；原人口、route phase、速度、elapsed-time 不減少。
- 可能最多 18 個 batches，常見遠景兩 model 共 6。旧模型是 2 draws；增加的外觀細節有實際成本，不能把 batching 說成 draw 比舊版少。

## 載入、所有權與交付格式

- 正式採用檔只放 `public/models/blender/` 的具名類別目錄。`adopted-manifest.json` 逐檔列 path、完整 SHA-256、bytes、來源 package／path。
- 採用 inventory 共 19 個 payload（含設備 metadata，manifest 本身另計），總 **2,664,657 bytes**。138 份 Blender source 和其餘交付 exports 仍保存在 repo 的離線工具區，並非全數部署。
- source `.blend`、inspection、研究 driver、未接入 station／內裝留在 `tools/assets/`；不放 public。普通 GLB，不新增 Draco／Meshopt／KTX2 依賴。
- geometry cache／shared materials 的 owner 是單一 engine consumer；個體使用 InstancedMesh，沒有每棵樹／每台車的私人 texture。
- HVAC 按成功模板替換完整來源設備群；失敗的模板各自保留舊群。車流須六份模板全部成功才接管，遠景仍使用 Blender LOD2。新樹須完整模板／四張 maps 成功才接管，超距、非 Ultra、未選取者使用原樹。
- disabled、載入失敗、晚回或 engine dispose 不得留下缺失的來源 visual；部分成功不得先隱藏尚未有替代物的原物件。
- 晚回 GLB／貼圖需釋放；移除 owned group 後釋放 geometry、material、texture、instance resources；Engine teardown 先取消新 consumers。
- 本機 QA `/__offline-assets/` 僅允許具名 package 的 exports GLB／PNG。正式 build 檢查 exact path/hash、拒絕未列管資產及 `.blend`，並按交付 content hash 阻擋偷放在其他路徑的候選素材。

## 獨立驗證與如何重現

### 離線與 Blender

1. 初始交付以 `node --test tests/offline-package-contract.test.mjs` 重核，21/21 通過；另由專用 validator 檢查 geometry／opening／alpha／來源契約，11 類通過。離線通過不代表已接入城市。
2. HVAC 六來源及成年樹十二來源以本機 Blender 4.5 重開，透過 package 的 source-preserving `export.py` 匯出至全新 `work/blender-integration/*-reexport`。沒有執行重建 defaults。
3. 原 `.blend` hashes 全部未變。跨 Blender exporter 版本 GLB bytes 有差異；HVAC oriented triangles、材質、position／normal／tangent 相同，UV最大差 `4.77e-7`；樹重新量測的 bounds／triangles／primitives／roles／nodes 相同。樹檢查沒有另聲稱每個 vertex bit 相同。
4. 正式仍採原交付 GLB，沒有以本機重匯出覆寫作者成品。

```sh
npm ci
npm run check
npm test
npm run build:firebase
# WebGL 本機 QA；instrumented bundle 不可部署
VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build
node tools/serve-visual-qa.mjs blender-ultra-oct3
```

系統 Python 可跑標準庫 common contract。專用 alpha/surface validators 需要 NumPy／Pillow，沒有套件時使用具備依賴的 Python；不能把缺依賴當素材驗證失敗。

2026-10-04 最後整合驗證：`npm run check` 通過；`npm test` **718/718 通過、零 skipped**（117.37 秒）；`npm run build:firebase` 通過，正式 isolation 核准 19 payload 並保護 176 個候選素材 hashes。首次全套 715/718 找出新增內裝 selector 與舊 DOM mock 的 options/value 落差，以及面板建立時過早讀取 camera limits；補齊 mock、延至實際內裝 framing 才存限制後，原 lease 斷言維持，定向 11/11 及完整 718/718 均通過。先前失敗與最後成功 logs 分開保留，不覆寫。

正式 bundle 在本機重新載入完成，初始時間仍為 10:00／300×；沒有本機 QA 面板、error 或 warn。GitHub 的 commit、main merge 與部署狀態以[本輪 PR #5](https://github.com/YiTaChen/vancouver-living-atlas/pull/5) 及其 exact-commit checks 為準，repo 摘要不預寫尚未產生的 merge hash。

歷史 consumer 指紋改為檢查 manifest 明示 `baseRevision` 的 Git blob；仍重核現行 GIS、模型與 fit。禁止把新版 runtime hash 偷寫成作者基準。CI checkout 必須包含歷史（`fetch-depth: 0`）。city-scale verifier 的工具 hash／aggregate fingerprint 因這項明示 migration 更新，7,794 項 building ledger 與 A01–A04 數值證據保持原值。`development-backlog/inventory.json` 仍是原基準快照，不改成新 runtime 的完成清單。

### 真正 WebGL

- 同一實際城市 canvas，1920×1080、固定相機／品質，晴天 14:00、陰天 14:00、黃昏 19.8、夜間 23:00。
- baseline／Blender 以 QA 按鈕切換，存實際 canvas PNG、相機、source probe、選取數、載入狀態、render counters、geometry／texture 數及 RAF p50/p95。
- 每條件 5 秒準備＋8 秒取樣，要求分頁可見、pose 不漂移、所需資產 ready。測量期間不併跑 Blender、build 或 CPU suite。
- `calls`／`triangles` 是整個 scene／multipass 的 renderer counter，非單物件 draw 或純 GPU timer；RAF 也不是 GPU frame-time。
- 相機與天鐘固定，但一般車流的 elapsed-time／route phase 繼續流動；兩次 capture 並非逐車相同動畫幀。街景效能樣本不單獨證明每台車皆在該畫面內可見。
- generic delivery selector 供單一模型、不同 LOD／角度、四光照 inspection，每條件 2.5 秒準備＋5 秒取樣。它不證明真實地理位置、開門、碰撞、移動乘坐或 source replacement。
- 公車與 SkyTrain 內裝追加實際走道視角及四光照擷取，確認座椅、扶手、地板與天花板可載入。視角依當前 attached bounds 的 minY + 1.65 m 固定，minY 是模型下界而非已驗證站立地面；目前是單獨內裝、未合外殼。夜間只有模型 emissive 元件發亮，仍缺正式車艙照明與外殼接合驗收，不能解讀為可搭乘完成。
- 第一輪 High 24 棵新近景樹確實有畫質改善及效能成本，因此先調到 High 16／Ultra 32，後因闊葉仍有約 20% FPS 成本，再限 High 8／Ultra 16 且拒用新針葉；最終 High 8 四光照取樣仍有顯著成本，改為僅 Ultra 8，High／Balanced 保留原樹。舊輪 raw evidence 保留，不混稱最終限額的測量。

正式採用 consumer 的四光照配對結果如下；測試硬體是 AMD Radeon Pro 560X／ANGLE Metal，同一 1920×1080 canvas。數字是各條件單輪 RAF FPS 範圍，不能當成其他裝置或手機的保證。

| 配對測試 | 原 consumer | Blender consumer | 實際啟用／判定 |
| --- | --- | --- | --- |
| High 屋頂設備 | 26.7–26.9 FPS | 26.6–28.1 FPS | 24 組／2 cells；保留來源位置與局部失敗 fallback |
| High 一般車流 | 22.3–22.8 FPS | 21.3–22.2 FPS | 原 287 actors 全數保留；外觀增益有小幅成本 |
| Ultra 闊葉近景 | 25.6–26.0 FPS | 19.1–19.2 FPS | 8 棵；成本顯著，只供 Ultra 選擇，不啟用於 High／Balanced |

一般車流另有 route 0 的實際來源近景：能看到窗、車燈、輪胎與道路接地，原視覺為兩個方塊；兩次擷取的 live route phase 不同，所以這組只證明來源車的外觀與 consumer readiness，不是 FPS 配對。曾標為 Ultra 的早期擷取實際是 High／零新樹，已獨立標記為 no-op 並排除；65 m probe 的 aggregate pool 尚有其他近樹，也不能拿總數 8 當成該 probe 未被距離排除。

另做 High／14:00 的 60 秒實際導航 smoke，使用旅遊模式的正常 2400×1350 render（不同於上述配對 canvas）。Robson 步行 238.5 m 通過連續性、品質穩定及 context 檢查。Robson 駕車雖行進 538.4 m、零 collision frames，約 33 秒後持續 W 輸入被清空，continuity gate 失敗；raw 未記錄 stop state，不能把原因定論為既有超速攔查或工具焦點。保留失敗，沒有宣稱駕車耐久驗收通過。兩次瀏覽器 error／warn logs 均空。

完整 logs／raw PNG／JSON 放 `work/blender-integration/`，有效 consumer 證據在 `work/visual-qa/blender-ultra-oct3/`、`blender-accepted-oct3/`、`blender-release-oct3/`；最後單模型檢查在 `blender-final-oct4/`。repo 保存[可追溯驗收摘要](visual-quality/blender-integration-oct3/README.md)、[逐檔 hashes 與判定](visual-quality/blender-integration-oct3/acceptance.json)，以及兩張未重繪的實際 renderer PNG。raw 記錄原 parent HEAD 與當次 dirty source fingerprint；不同 QA helper 修訂的擷取不冒稱來自同一最終 commit。任何未跑的驗收仍列為未跑，不用作者 CPU 圖代替 WebGL。

## 下一階段按城市尺度排序

1. **城市表面**：roof shared shader／UV phase、source contour 與地面砂／草的實際 consumer；保留明亮都市 palette，10:00 起始、300×天鐘及夜間極光。
2. **建築局部**：Waterfront／Marine source assembly 去重；modern/cedar frame＋paired sill 整組替換；先一個 source cohort，再擴 source-backed coverage。
3. **街段**：existing furniture slots／真步行面／門與路排除；不按任意世界 XYZ 散放新物件。內部椅櫃採具名 replacement，保留障礙與通行範圍。
4. **交通模型**：bus／metro 將不可動 role 合批，門輪保持動態，關閉／開啟／占用 LOD lock 與內裝 lazy-load；先固定一車的實際接合。
5. **搭乘系統**：真實 stop/platform source、連續路徑、停靠／門狀態、rider/car-local frame、座位／camera、上下車、終點／取消／load-fail安全恢復；禁止 moving gangway traversal，研究 disabled decks 不直接啟用。
6. **人物與駕駛**：角色 LOD 需保留 animation phase、獨立 skeleton/mixer、shared map ownership；自然 driver／可選 cockpit 成對接入並重新驗 camera、動態手腳與碰撞。

通過 source／CPU／WebGL 樣區及 production isolation 後才擴正式 coverage。所有來源 Blender 檔已隨交付分支保存；「合入素材」和「啟用正式 consumer」為分別記錄的成果。
