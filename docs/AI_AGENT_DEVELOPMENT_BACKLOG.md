# 城市景觀至街景體驗：AI agent 待開發需求與資產交接規格

更新日期：2026-10-03。盤點基準：main，`614cf841d0a188d0334c101150d15cc727e2f679`。本文件新增需求及交接契約，**沒有實作下列新模型、搭乘功能或宣稱它們已驗收**。後續 agent 開始工作前須重新核對 HEAD、來源 manifest 與現行 consumer。

目標是從城市全景逐層改善到可步行、駕車及未來搭乘公共運輸的街景。下列順序按**空間尺度由大到小**排列，並不表示所有遠景任務必須做完才能製作近景部件。資產可以平行製作，整合按依賴順序進行。

## 1. Agent 開始前：工作分工與完成的定義

使用者要求：其他 AI agent 製作後，由本專案的整合 agent（本次對話的 Codex）接入場景。**素材製作 agent 沒有 WebGL 是預期環境限制，不能因此停止可完成的建模，也不能將離線預覽填成瀏覽器驗收。**

| 角色 | 可完成的工作 | 交付狀態 |
| --- | --- | --- |
| 無 WebGL 資產 agent | 盤點、Blender 建模／材質／UV、LOD、門片動畫、GLB 匯出／重匯入、CPU 幾何與通道檢查、Cycles CPU 預覽、交接報告 | 全部離線項目通過後標為 `offline_complete`；整合仍為 `runtime_pending_webgl` |
| 有 WebGL 整合 agent | 來源 ID 選擇、載入／去重、材質解讀、LOD／cache／instancing、真實地面配置、碰撞與玩法、瀏覽器畫面／效能／生命週期驗收 | 通過指定樣區後 `sample_accepted`；擴展與正式發布另記錄 |

本文件內的新工作初始均為 `planned`。既有離線候選是庫存，不能將本文件的編寫當成完成它們的整合。

1. 先讀 [專案規格](PROJECT_SPECIFICATION.md)、[材質流程](MATERIAL_PIPELINE.md)、[最新素材整合紀錄](OFFLINE_ASSET_INTEGRATION_2026_10.md)、[城市明亮度紀錄](CITY_READABILITY_2026_10.md)；舊文件的測試數字和部署狀態須按日期辨識。
2. 既有城市以來源 footprint、高度、地形、道路及穩定 seed 建立。普通建築使用可重用部件；有獨特形態的地標才考慮獨立局部或完整資產。不得為單張畫面加入無來源的世界 XYZ 例外。
3. 維持白天自然明亮的溫哥華觀感：磚、砂岩、混凝土、灰白／礦物色屋頂及合理玻璃反射。保留材質差異；base color 不烘入暗影，不用全域曝光掩蓋尺寸或材質錯誤。
4. 既有開場為 **10:00、300 倍、持續流動**；車輛／角色移動以實際 elapsed time 更新。新交通素材及搭乘機制不能讓車輛跟著日夜時鐘加速 300 倍。
5. 離線交付放在 `tools/assets/`，預覽、驗證及來源可納入 Git。未驗收候選保持正式載入預設不變；是否進 `public/`、啟用 consumer 及發布由後續整合 agent 按實際證據處理。這是製作與整合的分工，**不是要求使用者逐步確認**；使用者既有自動開發／提交指示繼續有效。
6. 尊重 repository LICENSE／來源標記。參考網頁提供外觀及尺寸依據，不代表可以複製其照片、貼圖、模型或藝術作品。

## 2. 共通交付：格式、目錄與後續整合接口

### 2.1 每個資產包的檔案

新包使用 `tools/assets/<package-id>/`。優先沿用現有來源／生成器與材質定義；新增 IDs 用小寫英文與連字號，不以檔名版本或顏色代替材質角色。現有 package 的 manifest／validator 有固定 schema、資產數與檔案契約，**不可直接用本文件的新 schema 覆寫**。擴充時放獨立版本包或 migration 後相容入口，保存舊版 manifest／驗證結果；版本與相容性由交接報告明記。

```text
tools/assets/<package-id>/
  README.zh-TW.md                  # 現況、修改點、命令、限制、交接順序
  manifest.json                    # schemaVersion、穩定 IDs、成本、尺寸與接口
  source/<asset-id>.lod0.blend      # 真正可編輯、烘焙前來源
  source/<asset-id>.lod1.blend
  source/<asset-id>.lod2.blend      # 只有該類別需要時提供
  source/textures/                 # 相對路徑或 packed 原始 maps
  exports/<asset-id>.lod0.glb       # glTF 2.0；實際待整合輸出
  exports/<asset-id>.lod1.glb
  exports/textures/                # 共用 runtime maps；禁止每實例複製
  exports/<asset-id>.interior.glb   # 車廂等可延後載入的內部，若需要
  exports/<asset-id>.collision.glb # 簡化碰撞，可用 JSON primitives 替代
  qa/validation.json              # CPU／Blender 檢查結果
  qa/measurements.json             # 實際 bytes、bounds、tris、maps、環境
  qa/previews/*.png                # 實際匯出 GLB 重匯入後的預覽
  qa/handoff.json                  # 完成／未測項目、建議下一個整合入口
  build.py / export.py             # 可重現生成與保留來源匯出入口
  validate.py                     # CPU 尺寸／通道／包裝檢查
```

- `.blend` 是可修改來源，保留 mesh、UV、材質節點、必要 modifier／rig；不能用「匯回已烘焙 GLB」冒充完整原始製作來源。若只能從 GLB 重建，明寫重建來源及限制。
- runtime 用 **GLB/glTF 2.0**；不以 OBJ、FBX 或 Blender 檔直接載入瀏覽器。新增 Draco／Meshopt／KTX2 等擴充前先交付普通可讀版本，解碼器與成本留給整合 agent 決定。
- PNG 是預設底色／normal／ORM／alpha 交付格式；normal／ORM 不用 JPEG。Blender 預覽用 PNG，長影片及大尺寸渲染留在 work，不作 runtime 資產。
- 幾何優先共用 material roles、外部共用貼圖或無貼圖的角色佔位材質。若為方便單體檢視而另外輸出嵌圖 GLB，命名 `*.inspection.glb`，與 runtime GLB 分欄計算。
- 每個 `.blend` 壓縮保存；新包每個來源檔先以 **≤20 MiB** 為整理目標，較大來源須說明必要原因並拆分可編輯集合。這是版本庫管理目標，不是瀏覽器下載限制。不得為減少來源 bytes 刪掉可編輯內容。

### 2.2 manifest 必備欄位（新交付契約，現有 consumer 尚未通用支援）

根層：`schemaVersion`、`packageId`、`version`、`baseRevision`、`status`、`units`、`coordinateSystem`、`provenance`、`reexportCommand`、`validationCommand`、`assets`、`textures`。每個 asset 至少記錄：

| 欄位 | 要求 |
| --- | --- |
| `id / taskId / variant / kind` | 穩定 ID 與本文件需求 ID；保留既有 ID 的用途，不暗改語意 |
| `source / sourceSha256 / lods` | 相對包路徑、SHA-256；各 LOD 的 GLB、hash、實際 tris／vertices／primitives／bytes |
| `boundsM` | glTF root-local 完整 min／max／size，套用檔內 node transform 一次；size=max−min，W=X、H=Y、D或L=Z |
| `expectedDimensionsM / dimensionToleranceM / dimensionBasis` | 目標、容差、依據是來源契約／官方資料／代表性提案；不可混稱實測 |
| `pivot / attachmentDatum / frontAxis` | 原點、地面／牆面／屋頂／軌面身份、朝向；不只記錄外框尺寸 |
| `materialBindings` | GLB material 名稱／primitive 對應 semantic role、共用 surface ID、map 路徑與 channel；禁止依顏色猜用途 |
| `textureMode / textureCost` | external/shared/embedded；geometryBytes、embeddedImageBytes、GLB總bytes、去重後 uniqueTexelBytesWithMips 分列 |
| `lodPolicy / clearance / collision / anchors` | 建議切換方式、淨空／凹入、碰撞 proxy、門／輪軸／相機／乘坐點；未用到可為空陣列但須說明 |
| `placementCompatibility / intendedConsumer` | 適配哪些 profile／來源邊／屋頂類型及程式入口；不得只給預覽中的世界 XYZ |
| `offlineChecks / runtimeChecks` | pass/fail/not_run，環境與證據檔；未跑的 WebGL 項明記 not_run |

檔內 node 名稱固定，例如 `body-shell`、`glass`、`door-right-front-a`、`wheel-front-left`、`floor`、`seat-01`。同一 LOD 家庭保持 ID、原點及主要淨空一致；若有 breaking change，升版並提供舊新對照。整合 agent 不應猜測哪個黑色 mesh 是座椅、哪個小球是頭部。

### 2.3 尺度與原點：避免模型太大或放錯位置

- **1 unit=1 m**。Blender authoring 為 Z up；標準 glTF 輸出為 Y up，常見轉換是 Blender `(x,y,z) → glTF (x,z,-y)`。街面 +Z 朝街，車輛 +Z 前進且 −X 是右側。每包必須宣告實際軸向，不重複轉換。
- 獨立物件 mesh 應整理作者端 scale；正式放置理想 scale=`[1,1,1]`。合法的 glTF 軸轉換 node、角色骨架／inverse bind matrix 不得為「歸零」而破壞。
- 一般傢具原點在地面接觸中心；牆面件在牆面 attachment datum；屋頂設備底座在 local Y=0。新車輛以輪胎接觸面、列車以軌面接觸 datum 定義 Y=0，並提供所有地板／輪軸高度。舊 consumer 的高度 offset 不可直接搬到新模型。
- 新車輛 X=0 為車身中心線，Z=0 為前後主輪軸／轉向架中心的中點，朝向+Z。每個 profile 的 exterior、interior、collision、door／seat metadata **共用同一 vehicle root**，不能各自按 bounds 重新置中。以 `legacyToVehicleRoot` 明記舊模型到新 datum 的 transform。現有bus輪底約local Y=0.01，runtime另加地形ground+1.08；metro輪底約Y=0.02、rail頂為path Y=0。這些舊offset不是新floor高度。
- 小部件先以實際設計尺寸匯出；只允許在 manifest 宣告的適配範圍調整。線性簷口／壓頂用長度變體或重複段，保持斷面；窗洞、車門、座椅、人物不任意非等比拉伸。
- 樹可依來源 height 等比縮放成年樹模板；須保持 crown／trunk 比例、來源位置及 clearance。葉簇／幼樹研究件不能被放大當成年樹。
- 新樹 manifest 必填 `templateHeightM` 與 `normalizationMode`。目前 detailed-trees consumer 對約1 m正規化幾何直接乘來源height；若新模板實高10 m，整合scale應為 **sourceHeightM/templateHeightM**，22.9 m來源只能乘2.29，不能再乘22.9。離線量測幾何高度與metadata相符，整合agent提供此換算或明確重新正規化一次，禁止兩者同時執行。
- CPU 尺度驗收放入 **1 m 尺、1.75 m 人形及1.81 m人形**；1.81 m 對應現有 citizen 高度。參考物留在 QA 場景，不能進 runtime GLB。量尺寸以重新匯入的 GLB 為準。
- 固定尺寸部件，主要 bounds／attachment 的新匯出容差預設 **≤0.02 m**；既有 manifest 有更嚴格條件時沿用。植物輪廓另列容差；入口淨空、門行程及地板不能用 bounds 容差代替。

**已知必須保留的尺寸例外：**

| 項目 | 目前契約／陷阱 |
| --- | --- |
| Heritage bay | 真正 W×H×D 為 **3.25×3.1959×1.2207 m**，Zmin=0.0228、Zmax=1.2435；深度包含雨棚，不是可走入室內深度 |
| Modern bay | **3.20×3.20×1.703 m**，Zmin=0.0255、Zmax=1.7285；現有 compact bay 是貼在不開洞 GIS 牆前的 relief |
| 雙坡住宅雨棚 | 外框 **2.00×0.74×1.06 m**，但 Ymin=2.36、Ymax=3.10，原點在地面。不能把底部重新移到0再套舊配置，也不能按3.10當物件高度 |
| 現代窗框／雪松窗框 | 外框2.20×1.75×0.24／1.62×1.84×0.16 m；窗洞1.92×1.47／1.28×1.52 m。須核淨空，不能只看外框 |
| 住宅入口 | 外框約1.30×2.50 m，入口淨空1.04×2.30 m；雨棚下保持2.30 m淨空 |
| 街面配置 | 實際人行道至少三點；坡差≤0.14 m，threshold=最高點+0.02 m；bay頂須低於保留的第一層上窗台，不能任意使用 terrain Y |
| 屋頂機組 | 既有設備名義寬2.20–3.61、深1.65–2.45 m，普通高0.9–1.4 m；高樓首組可2.5 m。新設備尺寸須適配原footprint檢查，不放到小住宅斜屋頂 |
| 成年樹模板 | 目前近景最大水平冠幅約height的0.46–0.49，遠景冠半徑上限0.285×height；10 m模板對應約4.6–4.9 m冠幅、遠景半徑≤2.85 m。這是現有consumer包絡，不是所有真實樹種的植物學比例；物種或來源有更精確資料時需連同clearance契約變更 |
| 枝條研究件 | 約1.25 m研究件；保留作枝葉來源，不等同成熟市政樹木 |
| 候車亭／歷史燈 | generator名義亭寬4.56、深約1.86、高約2.82 m；歷史燈約4.49 m。重匯出後再測bounds，不拉伸歷史燈替代約8 m幹道路燈 |
| 公車／列車 | 公車主體12×2.5 m，鏡子擴大總寬；metro名義length=17 m但連接件可延伸至17.8 m，主體寬2.65、屋頂寬約2.8 m；均是現有展示模型尺寸 |

來源：[正式bay manifest](../public/models/streetscape/manifest.json)、[放置規則](../lib/city/streetscape-placement.ts)、[舊部件](../tools/assets/architecture-details/README.md)、[新部件](../tools/assets/architecture-expansion/README.md)、[屋頂配置](../lib/city/architecture-plan.ts)、[植被manifest](../tools/assets/vegetation_ground/manifest.json)。

## 3. 提案資產預算：大小指檔案、幾何與貼圖三種成本

以下是**新資產開始製作的提案上限**，未實測，不是全城 FPS 保證，也不追溯要求無關既有資產立即重做。超出時先記錄原因、實際成本及替代方案，整合 agent 在樣區量測後調整。表中幾何 GLB 排除圖像 bytes；LOD0是近景，LOD1是中景，LOD2只在需要時提供。

| Budget ID／用途 | 每模板 LOD0／1／2 tris | 每LOD幾何GLB整理目標 | 材質／貼圖 |
| --- | --- | --- | --- |
| B-GEO 城市GIS／地形／軌道 | 沿用來源及現行分區幾何，另量測 | JSON／現有meshing；不交付整城巨大GLB | 遠景新增常駐maps預設0 |
| B-PART 窗框、簷口、基座、雨棚小件 | ≤256／80；既有低模沿用，複雜件個別說明 | ≤64／24 KiB | 通常1 opaque primitive；新增唯一maps預設0 |
| B-BAY 新街面bay變體 | ≤8,000／800 | ≤512／96 KiB | ≤3 primitives；整批新增唯一maps先限4 MiB |
| B-ROOF 單組屋頂設備 | ≤480／96 | ≤96／24 KiB | 1–2 primitives；共用既有金屬 |
| B-HERO 單入口或地標局部整套 | ≤12,000／3,000／500 | ≤1 MiB／256／64 KiB | ≤3主要roles；必要時整套1組1024²三maps，約16 MiB |
| B-TREE 成年樹模板 | ≤8,000／2,000／240；按物種與現行pool另核 | ≤1 MiB／256／64 KiB | trunk／foliage分工；整批共享葉atlas，初始新增唯一maps≤8 MiB |
| B-CAR 一般車型 | ≤3,000／600／120 | ≤384／96／32 KiB | ≤3主要roles；整批共享maps≤4 MiB |
| B-TRANSIT 外觀公車／單節列車 | ≤8,000／2,000／400 | ≤1 MiB／256／64 KiB | ≤4主要材質roles；整套外觀共享maps先限16 MiB |
| B-CAB 公車／單節列車內裝 | ≤12,000／3,000；乘坐近景另載入 | ≤1.5 MiB／384 KiB | 內裝整套共享maps先限16 MiB；不能每座椅獨立貼圖 |
| B-FURN 路燈／長椅／候車亭 | ≤1,500/300、1,000/200、3,000/600 | 分別≤256/64、192/48、512/128 KiB | 傢具整套新增唯一maps≤4 MiB |
| B-PROP 室內／小街道物件 | 一般≤1,000／200；大型櫃台≤3,000／600 | ≤192／48 KiB；櫃台另核 | 1–2主要roles，共用現有角色材質 |
| B-CITIZEN 角色變體 | 沿用現有LOD0；新變體先≤40,000 tris，LOD另審 | **總包例外：**現有嵌圖GLB約3.34 MiB，新變體總GLB≤4 MiB目標；geometry／image bytes仍分列，幾何上限待拆賬後核定 | 共用22骨架／動畫；每新私有1024三maps約16 MiB，須另計 |

每一貼圖用未壓縮 RGBA8＋完整 mip 保守估算：W×H×4×4/3。單張256²約0.333 MiB、512²約1.333、1024²約5.333；三張同解析度PBR maps分別約1／4／16 MiB。PNG下載bytes不能當GPU texel residency。葉片 authored mips按實際級數加總，不能套完整mip公式後聲稱實測。

**現行成本必須保留的判讀：**

- 城市共同1024×512三maps規劃約8 MiB，只是這套庫。
- 正式兩種bay、兩LOD共四GLB，總5,155,696 bytes；各LOD的1024／512三maps估算共約40 MiB。現在 loader 保留GLB材質與貼圖，**來源共用不等於runtime已去重**。新增一款照舊帶兩LOD私有maps可能再約20 MiB。
- 小建築候選GLB也嵌入重複maps；幾何接入時要由consumer明確抽取、釋放／重綁，不能只在報告寫「共享」。
- 現行街面High最多24bays／6個LOD0，Ultra36／10；cache12cells；實際LOD0門檻High38 m／Ultra50 m。manifest的60／150 m只是早期建議。
- 建築detail cell=220 m，每cell roof≤650／street≤1800是既有box descriptor數，cache≤38，計畫工作≤96 steps／1.25 ms每frame。不能把650解讀為650台新增高模機組的許可。
- 新屋頂試點提案限2cells、High24／Ultra48組設備；成熟樹、車流及傢具保持現有人口／來源上限，按可見範圍替換。新幾何LOD0不是全城永久常駐。
- material role數不等於draw數；獨立門／輪組、首尾車與內裝仍會有額外primitives。交通包離線報告分別列closed exterior／open exterior／exterior+interior的實際primitive數，GPU多pass draws由整合agent實測。

## 4. 待開發需求索引：由城市全景到人尺度物件

「優化」含現有素材適配與整合；「新增」指目前缺少的模型／接口。所有需求須回填本節ID、離線狀態、整合狀態及證據。

| ID／尺度 | 範圍 | 工作性質／第一交付 |
| --- | --- | --- |
| A01 城市全景 | GIS量體、遠景城市色彩與材質角色 | 優化來源／consumer；維持大尺度輪廓 |
| A02 城市全景 | 地形、海岸、公園地表 | 優化共用表面與地表接界；來源維持 |
| A03 城市全景 | 水、天空、日夜與極光 | 優化既有renderer；不是Blender整城背景 |
| A04 城市基建 | 橋梁、軌道、高架／港口連接 | 優化近景結構件；交通路徑另查來源 |
| B01 街區俯視 | 屋頂機電與壓頂 | 新設備模型＋既有壓頂適配 |
| B02 街區俯視 | 平屋頂材質分類與近景細節 | 優化既有配色；新增必要PBR表面 |
| B03 街區／公園 | 成熟樹冠、主幹、葉簇 | 優化現有成年樹結構；新可重用葉簇 |
| B04 重點建築 | Waterfront／Marine／其他地標局部 | 優化現有入口與裝飾；獨立局部來源 |
| C01 街道立面 | Gastown歷史街面 | 既有零件整合＋必要轉角／店面變體 |
| C02 街道立面 | 現代大廳、低層／podium | 既有現代零件適配＋必要變體 |
| C03 街道立面 | 住宅窗框、入口及雨棚 | 既有住宅候選適配；不放大件硬塞 |
| C04 街道地面 | 鋪面、路緣、庭院、草土接界 | 優化表面consumer；新增局部邊界件 |
| D01 交通空間 | 公車站、SkyTrain月台／入口 | 新增可搭乘所需站點空間及錨點 |
| D02 車輛外觀 | 公車外殼、門、輪組 | 優化外觀並新增中空可開門模型 |
| D03 車輛內部 | 公車乘客與駕駛區 | 新增真正車廂、地板、座席、扶手 |
| D04 車輛外觀 | SkyTrain首／尾／中間車 | 優化外觀並新增分節、門及連接接口 |
| D05 車輛內部 | SkyTrain車廂／貫通道 | 新增乘坐內部與可檢查的連接幾何 |
| D06 搭乘整合 | 路線、停靠、上／下車、乘坐 | 新增runtime；由整合agent驗收 |
| E01 一般車輛 | 轎車、SUV、簡化車流 | 新增少量共享車型替換雙box |
| E02 可操控車輛 | Roadster、駕駛及材質 | 優化UV／roles；必要坐姿變體 |
| E03 港口／航空 | 船艇、飛機／直升機近景部件 | 有證據才優化局部；不全面重建 |
| E04 建築內部 | 三處公共大廳、SkyWalk／候船室 | 優化材質與傢具；維持原動線 |
| F01 街道傢具 | 路燈、長椅、候車亭 | 延伸已有generator，交付來源／LOD |
| F02 新街景內容 | 垃圾桶、消防栓、自行車架等 | 新增；先定位置／淨空／數量 |
| F03 小型植栽 | 花台、矮植物、草土邊界 | 優化既有／少量新增，保持尺度 |
| F04 人物 | Citizen LOD、警員／駕駛變體 | 優化既有，新增共用骨架變體 |
| F05 表面微細節 | 車漆、皮革、木皮、金屬、石材 | 優化／接入現有PBR，不重做整套 |

## 5. 城市、街區與建築需求明細

### A01–A04：先確保整個城市的比例與來源一致

- **A01／B-GEO：** `building-bodies.ts`／`facade-profile.ts` 保留輪廓、分部、height、foundation及source ID。資料錯誤先提供JSON來源對照／可信度，不製作替代整城GLB。遠景只需材質平均色與可辨識屋頂分類；近景窗框不進遠景常駐高模。交付格式為來源規則JSON、必要catalog更新及離線對照報告；實體尺寸完全由來源決定。
- **A02／B-GEO：** 沿用地形與海岸mesh，改善土、草、步道與砂地材質尺度；新512–1024px共用表面先用2×2 m與10×10 m離線coupon測試。現有2×2 m、高差0.1 m坡地研究件只供材質研究，不能鋪成全城地形，也不自動提供導航高度。
- **A03：** 水／天空保留動態shader、日夜與auto極光。Blender可提供材質研究，實際反射／霧／陰影及300倍時鐘由renderer處理；沒有WebGL者僅交研究與CPU數值檢查，不報城市畫面已改善。
- **A04／B-GEO或B-PART：** 保留來源橋面／欄桿路徑／軌道和連續高度；只為近距可辨識的欄桿接頭、支座、護欄提供獨立低成本件。橋寬、跨度、rail corridor位置以來源決定；不要為車輛模型好看而改橋／軌道尺度。可搭乘路線需求見D01/D06。

### B01–B04：從街區俯視到重點建築

- **B01／B-ROOF＋B-PART，新增與優化：** 新建2–3種有風扇護網、百葉凹槽、接管、倒角的機組；先以現有尺寸範圍建立變體。已有modern-parapet-cap先適配厚度／排水方向。屋頂底座local Y=0，完整bounds包含管件；提供底座佔地polygon和排除間距。保留roofBoxFits、holes與更高building parts排除；設備未必有真實逐棟資料，應標代表性配置。每型獨立.blend／兩LOD GLB／shared-metal role。
- **B02，優化＋必要新增材質：** 最近已加入穩定seed的瀝青、礦物灰與塗膜灰白代表性配色，尚非逐棟實測材料分類。下一輪新增礦物顆粒／膜面接縫材質板，建議1–2 m公尺週期、512px先測，總新增唯一maps≤4 MiB。保留roof來源輪廓和明度方向，不把所有屋頂改成白色；有授權材料資料再補source tags。見building-surface-palette.ts及CITY_READABILITY。
- **B03／B-TREE，優化結構：** maple／alder／Douglas-fir／western-redcedar保持物種角色、source seed、height與clearance。成年模板參考height=10 m，按來源height等比變換；寬高比例先沿用各consumer crown envelope，絕不把所有樹設為10 m。近景葉簇先以約0.2–0.6 m可見群聚作建模研究，不用一片數公尺的單葉平面；針葉採枝片角色。提供主幹／枝幹／葉簇分組、0/1/2 LOD、每葉簇bounds、公尺bark UV與straight-alpha契約。保留真實成年樹輪廓；新貼圖單獨替換已無明確改善，需重整card geometry。小枝研究件保留1.25 m身份。葉片colour與depth後續須用相同coverage／solid邏輯。
- **B04／B-HERO，優化局部：** Waterfront柱頭、山花線腳、門窗凹槽；Marine入口陶飾、銅格柵和浮雕是第一組。Waterfront現有柱半徑0.6 m／高8 m、柱頭約1.6×0.35×1.6 m，山花寬28／高3.5 m；這些是現有場景契約。Marine拱洞半寬2.55 m、起拱Y3.7、弧高2.82 m、凸出上限0.24 m，threshold後續依真實地面。分別交柱頭／裝飾單件與入口組裝圖，不把單柱預覽縮放當整個門廊。保留地標外殼與入口collision：Marine目前為觀賞凹入，不因GLB門洞就增加可進入能力。Canada Place／Science World／BC Place／Convention Centre／Vancouver House已有專用模型，只有具名近景缺口才追加局部；帆膜、玻璃及夜窗shader保持角色獨立。

### C01–C04：整片街面可重用，不逐棟調座標

- **C01／B-PART＋B-BAY，先整合現有：** architecture-details歷史8類已有可編輯來源及兩LOD，包括砂岩窗台、開洞框、簷線、基座、角件、入口框與兩種雨棚。先按window openings／樓層／街邊長度自動匹配，凹槽／倒角不足才修改.blend。新增轉角店面、長短不同bay須有新ID與width範圍，平面layout不能只換招牌。heritage bay已有正式版本；8128tris現有LOD0保持歷史記錄，新變體依B-BAY另控預算。
- **C02／B-PART＋B-BAY，先適配：** expansion現代窗框2.20×1.75 m、窗台2.26×0.16×0.30 m、壓頂、基座及倒角轉角已有候選。補opening datum、glass止口、入口淨空與corner handedness後才接入。modern lobby不隨意加高至上層窗，也不將門洞壓扁填滿邊長。未知商鋪維持虛構／代表性識別，不冒稱現實店家。
- **C03／B-PART，先適配：** 雪松窗框／窗台／雙坡入口雨棚已有候選；按住宅profile與現有門窗淨空配置。門框保留1.04×2.30 m淨空，坡面無法放置時提供fallback理由。雨棚的ground datum和2.36 m底高必須保留或升版說明，不能僅對齊模型底部。
- **C04／B-GEO＋B-PART，優化／局部新增：** Asphalt、concrete、street-brick已有共同材質。路面與人行道先修公尺UV、拼接和來源範圍；庭院／草土邊界用同表面材質混合或少量有來源的edge件，不全城疊加2×2m補丁。建築接地／道路及可走高度由現有surface系統決定。沿用source courtyard／planting footprint，局部地表件給contour、slope及排除道路／門口metadata。

## 6. 公車與SkyTrain：現況、內外部建模與搭乘接口

### 6.1 已優化過什麼（程式及Git核對）

| 項目 | 已有 | 尚未完成 |
| --- | --- | --- |
| 公車 | 2026-09-06 `3b265e8` 新增藍黃低地板代表性外觀、車窗、右側兩門、輪胎、鏡子、屋頂設備、目的地像素與後通風；共用1個InstancedMesh/material，1 km外不提交可見實例 | body是實心box，門窗是裝飾；無車廂、內壁／地板、座椅、門動畫、上車狀態。輪組合併，無獨立轉動；該模型文件之後沒有外觀改版 |
| SkyTrain | 2026-09-04 `d51e427` 新增原創metro四節編組、車窗／門／設備／燈；每節body／window／wheel約3 draws，車身與每輪軸沿軌道坡彎取樣，輪子轉動，車廂間距保持 | 實心box車身、正常狀態不透明窗、封閉裝飾門；無首尾／中間車區別、車內、貫通道、月台停靠或乘客附著 |
| 鐵路後續變更 | `612246e` 調整蒸汽品質條件，`3f44bcd`修正mapped措辭 | 不能算SkyTrain新精緻模型或搭乘系統 |
| Waterfront內部 | 已有可走的大廳、SkyWalk、SeaBus候船室及傢具 | 未建地下SkyTrain月台／隧道，未實現SeaBus搭乘；BOARDING文字不代表上車上船功能 |

來源：[city-buses.ts](../lib/city/city-buses.ts)、[公車實際畫面](visual-quality/buses/README.md)、[railway.ts](../lib/city/railway.ts)、[rail-path.ts](../lib/city/rail-path.ts)、[interiors.md](interiors.md)。上表歷史通過項目不表示本文件又重跑了畫面驗收。

### 6.2 選定車型及尺度，防止不相容混搭

第一個公車profile用 **12 m等級、寬約2.5 m** 的代表性低地板車，與現有車流相容；尺寸是本專案建模目標，非某款New Flyer的完整實測。保持+Z前進／−X右側門。記完整鏡子／設備bounds與輪軸，不把總寬當車廂淨寬。

第一個metro profile暫定 `expo-metro-17m`：沿用 **17 m名義單節、四節代表性編組**，另記車體、連結件及編組實際長度。這不是宣稱完整Mark II/III複製。真實MKII有17.1m及兩／四節編組，MKIII是約68m四節且可貫通；Mark V則是五節。**Mark V若另做，必須有獨立車型profile／編組／月台長度，不把五節車外觀套在四節17m模板。** [TransLink官方車型資料](https://www.translink.ca/about-us/about-translink/operating-companies/british-columbia-rapid-transit-company)

Mark V官方公開內部可作站立區、扶手、LCD、車門與開放貫通道的研究參考；不複製屏風上的藝術作品或照片像素。不同官方頁面的總長值亦有差異，真正擬真建模須記錄選定圖紙及測量定義，不混用數字。[TransLink內部照片及功能](https://buzzer.translink.ca/2025/07/translinks-mark-v-skytrain-enters-service/)

### 6.3 D01：站點、月台與入口空間（新增）

- 路邊站牌／候車區與鐵路月台是獨立資產，車廂不能代替車站。優先選擇有來源並能接現有walk surface的一個公車站對、一個可供測試的SkyTrain站點空間。
- 離線agent交站牌／雨棚／月台邊／導引牌模塊及 `station-layout.json`：stop ID、來源、站點local frame、站立／候車區polygon、月台floor height、door alignment points、靠站方向、entry connection及排除區。
- 月台長度須覆蓋**整個編組bounds及停車容差**；月台寬先以3–5 m代表性研究目標建coupon，有真實資料時改按來源。連接、間隙、輪椅區等是建模／遊戲目標，不宣稱公共運輸法規認證。
- 不能把Waterfront現有SeaBus通道當作SkyTrain地下入口。真實入口／路線由整合agent查圖後落地；無資料時label為研究layout，不硬加地下路徑。

### 6.4 D02／D03：公車外觀與內部（優化＋新增）

- 外觀B-TRANSIT：真中空body、合理圓角／車頭曲面、輪拱／輪胎、玻璃開口、前後獨立門框與門片、鏡子和roof設備。model貼圖分paint／rubber／glass／lights，保留車燈獨立role。
- 內部B-CAB：連續floor、wheel-well、壁面／頂棚、driver partition／簡化駕駛座、乘客座椅、扶手桿、停車鈴、小屏幕及可留空輪椅／嬰兒車區。門口不能被body實心box封住。
- 尺度研究目標：前門低地板約0.32–0.40 m（相對輪胎接觸datum）；乘客淨高≥2.05 m；走道優先≥0.75 m；座寬0.43–0.50 m／座深0.40–0.48 m／座面離局部floor約0.43–0.48 m；門口淨寬先0.95–1.25 m、淨高≥2.0 m。全部明確標代表性提案，用1.81m人形與head capsule檢查；有選定車款資料則按資料重定。
- 後部可能有抬高floor，須給floor分段polygons／height、台階或坡面與障礙。不能只提供一個floorY導致人物腳懸空或穿底。
- Front/rear doors須可獨立控制、給closed/open endpoints／行程／pivot與開門掃掠體積；可提供named clips，也可給純transform參數，供runtime播放。
- wheels分獨立nodes並記錄axis、center、radius；driver／乘客／內裝獨立角色。影像完整外觀、車內沿走道、門開關與人物比例都來自實際GLB重匯入。
- exterior LOD1/2可保留簡化內影／封閉視覺fallback，但限**無乘客、門關閉、不可登乘**展示狀態；載客、開門或上下車時須鎖定支持該狀態的LOD。每LOD在manifest給 `doorsAnimated`、`passengerCapable`、`openingsPreserved` 能力。詳細interior按乘坐／近景單獨載入，全城展示公車不同時常駐12k-tris內裝。

### 6.5 D04／D05：SkyTrain外觀、分節及內部（優化＋新增）

- Exterior B-TRANSIT按 `lead`、`middle`、`tail`或可重用雙向首尾profile拆分；共用uv／paint／glass。end car有觀景前窗，不加未聲明的駕駛艙假冒無人駕駛列車。
- 真車體空腔、獨立門、內外窗面、轉向架／wheel nodes、coupler和gangway anchors；每門記錄side與所屬car。車門淨寬先1.2–1.6 m研究目標、淨高≥2.0 m，不強迫匹配舊1.15m裝飾門。整合時升版舊門數據。
- Interior B-CAB給地板、壁／頂棚、座椅／站立區、扶手、優先座、可留空的輪椅／自行車區、路線／下一站顯示屏role及端部觀景。內裝統一人尺度與≥2.05m淨高目標。
- 車廂floorY相對軌面、門檻Y、輪軸及平台對位須一致；舊地鐵body使用local高程不等同內裝floor。新包用顯式datum，不能硬抄body中心Y。
- 真貫通道須給前後 `gangway` frame、可走polygon、clearance、彎道掃掠／可伸縮段；首批可以先完成**單節可乘坐**，整列車廂間穿行待接縫及moving collision驗證後開放。離線通道開洞不等於已實現行進中跨車廂移動。
- 每car的外觀／interior共享資源，整合使用car-local transform；方向翻轉僅改變整車姿態，不暗改left/right門ID。

### 6.6 車輛交接metadata（供整合agent直接使用）

新增 transit manifest 的 `vehicles[]` 至少包含：

| 分組 | 必填內容 |
| --- | --- |
| 尺寸 | body／完整bounds、nominalLength、輪胎或rail contact datum、floor分段、door sill、ceiling／clearance |
| 輪組 | wheel node IDs、axle／bogie centers、radius、spinAxis、導向wheelbase |
| 車門 | 穩定door IDs、side、所屬car、opening polygon、closed/open transform、animation clip或行程、swept bounds |
| 乘客 | walkableFloor polygons、standing regions、seat position／facing、camera anchors、headroom與座椅／壁面障礙 |
| 接口 | boarding point／outward normal、door-local to vehicle-local transform；列車另有coupler／gangway frames |
| 組成 | 可獨立lazy-load的exterior／interior／collision files、materials角色、共享texture key、LOD映射 |

所有資料須明記 `frameId`；默認是車輛或單節root-local，單位m。door-local等子frame用明確的parentFrameId及local-to-parent transform連到vehicle frame。靜態node錨點可留在GLB，機器可讀numeric值同時寫JSON，驗證兩者誤差≤0.02 m。車門、車輪或gangway為必要動態節點，不能為減少draw一律merge掉。

**新交通包的規範性資料型別：**

- 根 `vehicles[]` 中每項有唯一 `vehicleId`、`profileId`；`assetRefs.exterior/interior/collision` 引用根 `assets[].id`，不可填寫未存在的ID。無collision GLB時用collision primitives並明確設assetRefs.collision=null。
- Point／Vector 為3個有限數的XYZ array；尺寸為非負m，方向向量須非零。`translationM`同為XYZ，`rotationQuaternionXYZW`為4個有限數、單位四元數，transform以T×R×S合成；scale為XYZ且默認[1,1,1]。
- `frames[]` 組成無環樹，vehicle root無parent；其餘parentFrameId存在。frames里transform是**local-to-parent**，anchors明確在哪個frame表達，禁止把world數值寫成local。
- `floorSurfaces[]`用 `verticesM: number[][3]`＋`indices: integer[]`，indices每3個為三角形，triangle winding normal朝局部+Y；因此同時表示平面／斜坡／抬高floor，不用含糊的單一floorY。邊界區域使用 `polygonM` 的XYZ頂點，須共面且無自交。
- `doors[]`的openingPolygonM在frameId下，outwardNormal同frame；doorFrameId引用門片rest frame。open/closed transforms均相對於該door frame的**同一parentFrameId**；door animation節點ID及clip存在。sweptBoundsM同樣聲明frame。
- `seats[]`給pelvisPointM、facing quaternion與cameraEyePointM，明確人體參考為pelvis；站立點給feetPointM與headClearanceM。`standingRegions[]`、collision／camera／gangways同樣聲明frame。整合agent按現有rig換算角色root，不能把pelvis數值當腳底。
- 每LOD有布爾 `doorsAnimated/passengerCapable/openingsPreserved`。GLB node IDs、外觀／內裝／碰撞引用、frame、anchor必須在CPU validator交叉核對。

以下只示範一個門及floor的數據形狀；數值是代表性示例，**不算已建成公車或完整車廂佈局**。正式交付必須記錄全部門、座位、frame、wheel與collision，並以實際GLB量測取代示例值。

```json
{
  "vehicleId": "city-bus-12m",
  "profileId": "low-floor-bus-12m",
  "assetRefs": {
    "exterior": "city-bus-12m-exterior",
    "interior": "city-bus-12m-interior",
    "collision": null
  },
  "frames": [
    {"frameId": "vehicle", "parentFrameId": null, "units": "m", "upAxis": "+Y", "frontAxis": "+Z"},
    {
      "frameId": "door-right-front-a",
      "parentFrameId": "vehicle",
      "translationM": [-1.25, 0.36, 4.2],
      "rotationQuaternionXYZW": [0, 0, 0, 1],
      "scale": [1, 1, 1]
    }
  ],
  "floorSurfaces": [
    {
      "surfaceId": "front-floor",
      "frameId": "vehicle",
      "verticesM": [[-1.1, 0.36, 1], [1.1, 0.36, 1], [1.1, 0.36, 5], [-1.1, 0.36, 5]],
      "indices": [0, 2, 1, 0, 3, 2]
    }
  ],
  "doors": [
    {
      "doorId": "right-front-a",
      "nodeId": "door-right-front-a",
      "frameId": "vehicle",
      "doorFrameId": "door-right-front-a",
      "side": "right",
      "openingPolygonM": [[-1.25, 0.36, 3.6], [-1.25, 0.36, 4.8], [-1.25, 2.46, 4.8], [-1.25, 2.46, 3.6]],
      "outwardNormal": [-1, 0, 0],
      "closedTransform": {
        "parentFrameId": "vehicle",
        "translationM": [-1.25, 0.36, 4.2],
        "rotationQuaternionXYZW": [0, 0, 0, 1],
        "scale": [1, 1, 1]
      },
      "openTransform": {
        "parentFrameId": "vehicle",
        "translationM": [-1.28, 0.36, 4.9],
        "rotationQuaternionXYZW": [0, 0, 0, 1],
        "scale": [1, 1, 1]
      },
      "boardingPointM": [-1.7, 0.36, 4.2]
    }
  ],
  "seats": [
    {
      "seatId": "seat-01",
      "frameId": "vehicle",
      "pelvisPointM": [0.7, 0.81, 0],
      "facingQuaternionXYZW": [0, 0, 0, 1],
      "cameraEyePointM": [0.7, 1.45, 0]
    }
  ],
  "lodCapabilities": [
    {"level": 0, "doorsAnimated": true, "passengerCapable": true, "openingsPreserved": true},
    {"level": 2, "doorsAnimated": false, "passengerCapable": false, "openingsPreserved": false}
  ]
}
```

### 6.7 D06：由整合agent完成搭乘（新runtime；不是建模完成即完成）

當前公車沿獨立直線路段取模循環，不含站點／連續轉彎／停靠；SkyTrain為約855／894m兩條裁切高架來源段，端點淡出重生，資料特意排除站房屋頂／隧道／建築通道。`focusTrain()`只做Orbit定位。現有walk／drive／boat travel沒有rider狀態。

後續依序實現：

1. 連續道路／軌道服務path、站點列表與合法stop transform；優先兩站短程示範服務，保持當前展示交通fallback。裁切展示線不能自動宣稱真實整條運營線路。
2. vehicle service state：approaching → stopped → door_open → dwell → door_closed → departing；bus stop bell請求、train next-stop資料獨立於300x天鐘。
3. passenger state：walking → boarding → seated/standing → riding → alighting → walking；僅靠站／門開／alignment有效才允許交接。身份、car ID、座標不由相機位置推測。
4. 乘客與相機附著vehicle/car-local frame；第一批固定座位及可轉視角，再擴站立／車內步行。彎道／坡道／突然減速不能甩出車廂；玩家離開Orbit後可返回同一vehicle。
5. 上下車與walk surface／floor／door threshold連續，不傳送到路中或軌道；collision與視覺門同步。門未關不能發車；非靠站不任意下車。
6. 有乘客的車不能套用原端點淡出／重生。定義終點停靠、返程、取消乘坐／scene dispose／visibility pause／加載失敗的安全狀態及腳下表面。
7. 有WebGL者驗證內外景透視、透明窗排序、門動畫、人物比例、裝置輸入、回到步行、遠近LOD與重復搭乘後的資源釋放。

此為未開發功能。離線agent完成車廂模型後，應把D06的runtimeChecks全部留 `not_run`，整合agent接手後逐項改變狀態。

## 7. 車輛、室內、傢具與人物需求明細

- **E01／B-CAR，新增：** 普通車流在environment.ts目前僅body＋cabin雙box。先交轎車／SUV兩型，第三型視有效收益新增；車身研究範圍長4.2–4.8／寬1.75–1.95／高1.4–1.7 m，SUV可高1.65–1.85 m。輪胎半徑0.28–0.36 m研究目標，保持車長／wheelbase比例並給turn／collision envelope。共享可換色paint、glass、rubber，不替換交通路線或擴大人口。car LOD2保留現有簡化層。
- **E02，優化／局部新增：** Roadster已有曲面、真實cabin／輪拱開口與獨立輪組；先修公尺UV及material semantic grouping再測試已有車漆／rubber／leather。現有`leather`實際用於driver頭部，seats混在`dark`，不得按名稱直接貼皮革。駕駛變體以existingrig保留坐姿／手腳錨點，前排座高與driver視點按現有車艙量測，禁止整車為容納人物而非等比拉大。
- **E03，選擇性優化：** harbour／aircraft已有專用曲面與cockpit，保留船殼、浮力／碰撞尺度、翼展、旋翼及控制datum。只有已定位的近景金屬／座席／欄桿缺口才交B-PART／B-PROP；完整重建須先記錄現有bounds與動力學接口。不能因為不是.blend就認定現有模型無效。
- **E04／B-PROP，優化：** Science／Canada／Waterfront及SkyWalk已有floor／入口／傢具。先補interiors.Parts的UV（目前刪除uv）、拆清floor／wood／plaster角色，採用已有terrazzo／oak／plaster。傢具研究：座面約0.43–0.48 m、桌面0.72–0.76 m，櫃台約0.9–1.1 m；實際door／floor／碰撞尺寸優先。模塊單獨.blend＋兩LOD／sharedroles，不把整個大廳導成另一個不匹配source floor的GLB。保留light lab、顯示屏、夜燈、cutaway和原通道。
- **F01／B-FURN，已有生成來源的整理與優化：** cedar-bench、heritage-lamp、transit-shelter已有Blender generator，正式source／GLB庫目前主要是兩種bay。先輸出獨立傢具來源與LOD，重開後量bounds；bench名義W約2.02 m、座面中心0.48 m；heritage lamp約4.49 m，另建幹道路燈7–9 m研究型，不能拉長歷史燈。候車亭按既有4.56×約2.82×約1.86 m尺寸，保留headroom及人行淨寬。材質以木／metal／glass／diffuser分工，diffuser並不自帶點光源。
- **F02／B-PROP，新增內容：** garbage bin、hydrant、bike rack、bollard目前未找到完整可重用街道資產管線，應明記new。研究目標：垃圾桶高0.8–1.1 m／寬深0.4–0.65 m、消防栓高0.7–1.0 m、自行車架高0.75–0.9 m、防撞柱高0.7–1.0 m；型號按位置資料或代表性用途選擇。給footprint、通行／車門排除及source-selected placement提案，先少量樣區，不全城隨機撒布。
- **F03／B-PROP，優化與少量新增：** 現有7-triangle perennial、花台與ground研究源保留；矮植株研究高0.15–0.6 m，花台高0.35–0.65 m，按既有population／footprint配置。soil/grass edge clamp-U／repeat-V契約與低頻weight屬性不能混用。沒有完整地面consumer時先交研究件，不擴大花草數量掩蓋素材質量。
- **F04／B-CITIZEN，優化＋新增變體：** 1024px全幾何LOD0已經正式採用（37,799tris／22bones／idle-walk-run）。LOD1/2現有來源約30,825／27,531tris，後腰cloth／shading有差異，距離selector／fade／residency未接。先修差異與consumer，保留現有1.81m高度與bone matrices。警員帽／badge／制服及driver坐姿獨立變體，root-motion／導航距離契約不暗改；顔、手、鞋、領口／背包保護。不得為新制服把每NPC都換成更高面數。
- **F05，優化材質及接入：** role-materials已有8種／24張256pxmaps，含brushed aluminum、pale panel、paint、rubber、leather、terrazzo、oak、plaster。先建立consumer UV與roles；材料研究coupon不是完整汽車／地標／傢具。新材質只補確實缺口，512px為起始、1024px須有近景收益；保存.editable節點／原map／重新bake入口。Basecolor=sRGB，normal／ORM=Non-Color、normal OpenGL+Y、ORM R=1/G=roughness/B=metallic。材質物理週期使用catalog；不把某次模型縮放後UV也隨意縮放。玻璃／leaf-alpha／水／膜面／LED／night windows／screens保持專用consumer。

## 8. 無WebGL的驗收、交接與後續場景整合

### 8.1 離線agent必須完成的檢查

1. 保存獨立source；用保留來源方式reexport到新輸出目錄。不能重新生成defaults覆寫手動編輯再說roundtrip成功。記Blender版本、CPU設備、命令、source/output hash及錯誤。
2. 在空白場景import **實際交付GLB**，測world transform後bounds、軸／pivot、地面／牆面／軌面datum。清除reference人形後確認GLB沒有多餘lights／camera；故意命名的camera anchor Empty可以保留。
3. 檢查finite vertices／indices、tris、primitives、normals／UV／tangents，負scale／翻面、貼圖路徑／通道／color-space、alpha／double-side語意、mesh transforms。角色必須另驗rig／skin／動畫姿勢。
4. 洞口／淨空以剖面、ray或CPU geometry測試核對，不只拍front面。查重復coplanar面、門開關swept intersection、collision proxy／visible floor誤差、人形腳／頭／肩寬比例及座位位置。
5. LOD同視點並排，比較bounds、輪廓、door／window openings、datum與major anchors。小件容差≤2cm；成熟樹另記冠幅及height差。LOD不封閉已開放的門洞、不讓車輪中心改變。
6. 分開報告GLB總bytes／geometry bytes／嵌圖bytes／unique texture estimates／material primitives；同texture hash不得重復算成獨立來源。CPU預估不能寫成GPU實測。
7. Cycles **CPU** 渲染實際GLB：正、側、後、俯視／LOD配對、人形比例；材質晴／陰／黃昏／夜四條件；車廂額外渲染open/closed door、沿走道、剖面、每入口／座位視點。這些是離線研究照明，不與城市天氣宣稱一致。CPU資源不足時縮至1280×720／低samples並報告；完全未渲染的交付標partial，不冒稱視覺檢查通過。
8. 寫handoff：每需求pass/fail/not_run、已知缺陷、consumer建議、必須保持的來源／axis／roles、完整文件列表、修復與使用順序。離線全過即可完成 `offline_complete`，WebGL缺失不是離線製作失敗。

### 8.2 交給整合agent的具體包裹

`qa/handoff.json`必須能回答：**從哪個commit、載入哪個文件、用哪個原點、替換哪些舊件、復用哪些材質、尚未測什麼。** 建議根結構：

```json
{
  "schemaVersion": 1,
  "packageId": "<stable-package-id>",
  "baseRevision": "<full-sha>",
  "taskIds": ["D02", "D03"],
  "assetStatus": "offline_complete",
  "integrationStatus": "runtime_pending_webgl",
  "webglAvailable": false,
  "manifest": "../manifest.json",
  "sourceEditsPreserved": true,
  "offlineEvidence": ["validation.json", "measurements.json"],
  "runtimeChecks": {"status": "not_run", "reason": "No WebGL in asset environment"},
  "intendedConsumers": ["lib/city/city-buses.ts"],
  "replaces": ["<current stable asset/role IDs>"],
  "knownLimitations": [],
  "nextIntegrationSteps": ["Validate local datum", "Bind shared roles", "Run scene sample"]
}
```

上面是**格式示例，不是已通過報告**。寫入真實包時替換所有佔位符，不能留下假source hash或未執行的pass。來源README須提供從repo根目錄可執行的確切export／validate命令，不把整合agent綁在作者電腦的絕對路徑。

提交資產時包含source、exports、maps、manifest、qa與說明，不只push PNG或離線漂亮預覽。單一package為一個可review交付，避免同一分支混入不相關源數據／runtime改寫；用戶既有自動commit／push／main指示按工作範圍執行。交接記錄明確branch／commit；`offline_complete`可合入來源庫，但與正式runtime採用是不同狀態。

### 8.3 整合agent的執行與驗收

- 先核manifest／hash／CPU尺寸，在測試route加載完整候選。綁定真實surface roles，確認加載後資源去重／失敗fallback；源GLB材質是否保留或釋放必須顯式記錄。
- 第一個來源選定樣區（Gastown／Waterfront／現代街面／住宅／公園／短程transit）保留baseline/candidate。接入口、source IDs、profile、surface高度，替換對應舊實例並suppress重疊；不新增空懸裝飾或第二套collision。
- 確認shader、法線／ORM／alpha與colour/depth一致、LOD／opaque＋glass層次及晝夜窗燈；Geometry完成不表示材質consumer完成。
- 實際WebGL同相機clear14h／overcast14h／dusk19.8h／night23h；遠、中、近與步行／駕車視角。搭乘額外驗證停靠、門、座位、移動frame／上下車、touch及錯誤恢復。無GPU環境不偽造此項；交接後由有WebGLagent接續。
- 保存device／renderer／resolution／quality／camera／time／weather／revision／source fingerprint、實際canvas圖及frame time、p50/p95／calls／tris／geometry／texture counters。RAF gap不是獨立GPUtimer；短測不推定全城／手機FPS。效能採樣期間不併跑Blender或build。
- 重復進入／離開／LOD／搭乘／重新加載，檢查texture／geometry釋放及context loss。任何未解決穩定性事件留在報告；不能因為離線source通過就隱去。
- 檢查適當幾何／consumer回歸、`npm run check`、`npm test`、`npm run build:firebase`及production QA isolation；代碼／資產變更才運行相應檢查。本文件純文檔編輯不重跑所有660項或宣稱新增模型已測。main push會觸發現有CI／Hosting流程，發佈與源碼提交狀態分別記錄。
- 現行production verifier主要檢查已知候選檔名／字串，**不是所有新package的通用隔離保證**。新增包時，整合agent須擴充該包的URL／asset allowlist或排除檢查，核對實際dist檔案與runtime fetch；離線來源合入main不應自動把inspection／未採用GLB、maps或QA controls帶到正式站。

## 9. 推薦實施批次與完成記錄

1. **共同尺度及庫存核對（跨尺度）：** 建立固定manifest、datum、roles和離線validator；把現有16類建築件／bay／植被／role maps／citizen對應到本文件ID，避免重復生產。
2. **大尺度可讀性及俯視樣區：** A類維持來源，B01/B02屋頂樣區、B03成年樹，B04先Waterfront／Marine入口局部。有景象問題先修consumer，再補Blender件。
3. **完整街段：** C01–C04與F01，不同歷史／現代／住宅街面，保持來源與人尺度；同街段E01共享轎車／SUV驗證。
4. **可交接的公共運輸模型：** D01–D05可由無WebGLagent並行製作。先公車與單節metro含完整interior／anchors，再補首尾／中間車與gangway；D06由整合agent先實現兩站短程／固定座位。
5. **近景傢具及角色：** E02/E04/F02–F05，先接現有PBR與角色LOD，再決定新增街景人口／變體。E03依具體缺口排序。

每批獨立記錄以下狀態，**不以一個「完成」覆蓋全部環節**：

| 需求ID | 來源commit／包 | 製作狀態 | CPU／Blender證據 | 整合狀態 | WebGL證據 | main／發布 |
| --- | --- | --- | --- | --- | --- | --- |
| 示例，勿當結果 | 未製作 | planned | not_run | pending | not_run | 未採用 |

更新需求狀態時保存舊證據，不把舊phase測量當新版本結果。本文件的提案預算、代表性尺寸和規劃如有更可靠數據可調整，記錄理由與具體影響，不默默改origin或把研究件改稱現實測量模型。

## 10. 參考入口

- [Blender交接庫存](BLENDER_ASSET_HANDOFF_2026_10.md)、[實際素材採用及限制](OFFLINE_ASSET_INTEGRATION_2026_10.md)、[全專案規格](PROJECT_SPECIFICATION.md)。
- [建築detail consumer](../lib/city/architecture-details.ts)、[屋頂／街面plan](../lib/city/architecture-plan.ts)、[正式街面loader](../lib/city/streetscape-kit.ts)、[tree geometry](../lib/city/assets/tree-geometry.ts)。
- [bus geometry及更新](../lib/city/city-buses.ts)、[一般車流](../lib/city/environment.ts)、[列車／軌道](../lib/city/railway.ts)、[來源鐵路線](../public/data/railways.json)、[public interiors](../lib/city/interiors.ts)。
- [TransLink車型規格](https://www.translink.ca/about-us/about-translink/operating-companies/british-columbia-rapid-transit-company)：2026-10-03核對，供車型差異及名義長度研究，不把本站車型標成精確複製。
- [New Flyer Xcelsior產品入口](https://www.newflyer.com/new-flyer-buses-meet-the-xcelsior-family/)：35／40／60ft不同級距，建模先選一種，不混套車長及內裝。
- [TransLink Mark V內部](https://buzzer.translink.ca/2025/07/translinks-mark-v-skytrain-enters-service/)、[站點入口／線路](https://www.translink.ca/schedules-and-maps/skytrain)：僅供研究與來源選擇，動態班次不直接硬編碼為遊戲事實。
