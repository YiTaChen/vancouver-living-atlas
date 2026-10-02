# 城市材質與 Blender 資產製作流程

本文件盤點目前的主要物件、材質來源與製作方式，作為後續整批製作、替換及驗收的共同規格。這一輪已把八種常用表面建立成可編輯的 Blender 材質庫，接入 GIS 建築、街道與既有店面模組；樹木、水面、地標、交通工具和人物仍各有自己的渲染方式。**八種共用材質完成，不等於全城所有物件都已重新建模。**

## 1. 目前的物件與材質盤點

「本輪接入」表示程式與資產已納入目前實作；實際畫面、效能與發布狀態仍以該階段的整合 QA 紀錄為準。

| 類別 | 目前的幾何／材質來源 | 本輪成果與尚未涵蓋的部分 |
| --- | --- | --- |
| 一般建築主體、六種立面類型 | GIS 輪廓、高度、建築分部；[建築主體](../lib/city/building-bodies.ts)與[類型規則](../lib/city/facade-profile.ts)產生幾何及窗格 | 不透明牆面接入共用材質；保留原有窗格、玻璃與夜間發光規則。六種類型是代表性外觀，並非逐棟實測材質分類。 |
| 立面凸凹、窗框、窗台、基座及簷線 | [街面實例化細節](../lib/city/streetfronts.ts)、[歷史街面配置](../lib/city/heritage-frontage.ts) | 共用表面角色及實例屬性；保持窗戶淨空、實際人行道高程與既有樓層。尚未把每種窗框、簷線都做成獨立 Blender 模組。 |
| 近景店面／現代大廳單元 | [既有 streetscape GLB 模組](../public/models/streetscape/manifest.json)、[載入及實例化](../lib/city/streetscape-kit.ts) | 兩種既有 bay、各兩個 LOD，改用共同表面來源，新增四個可獨立修改的烘焙前 `.blend`。本輪並非從零新雕出四套完整建築。 |
| 屋頂 | 建築主體內的平屋頂，以及[來源支援的屋頂形態](../lib/city/building-roof.ts) | 已有坡屋頂使用瓦片表面；平屋頂使用代表性的瀝青表面。未憑材質庫新增任意屋頂高度、坡度或設備。 |
| 車道、路緣、人行道、Water Street 鋪面 | [道路網格](../lib/city/road-surfaces.ts)、[歷史鋪面配置](../lib/city/heritage-paving.ts) | 道路瀝青、一般混凝土、歷史街磚共用材質庫；沿既有道路／人行道網格取樣與分區，不靠貼上一大片平面修補。 |
| 土地、草地、海灘及接地 | [引擎地形](../lib/city/engine.ts)、[地面協調](../lib/city/harmonize-ground.ts)、[海灘地面](../lib/city/beach-ground.ts) | 原有高程、三角網格及頂點色仍是基礎。全城土地尚未轉成八材質 atlas，也未新增全面地表掃描。 |
| 住宅庭院過渡 | [配置規則](../lib/city/residential-ground-plan.ts)、[實際地形貼合](../lib/city/residential-ground.ts) | 新增有上限的低彩度土床與矮植栽，保留門前通道，排除道路、人行道及鄰棟重疊；是代表性補充，並非實測地籍庭院還原。 |
| 樹幹、樹冠、葉片 | [近景樹木](../lib/city/detailed-trees.ts)、[幾何](../lib/city/assets/tree-geometry.ts)、[共同骨架](../lib/city/assets/tree-structure.ts)與原有葉片／樹皮貼圖 | 中距與 Ultra 共用主要枝幹／冠形及穩定種子；細節層級不再另外重抽主要形狀。遠景樹冠系統保留，並非整座森林改成 Blender GLB。 |
| 水面 | [水波](../lib/city/water-waves.ts)與引擎水面材質 | 保留專用波紋、法線及近景效果；八種不透明表面材質未取代水面系統。 |
| 地標 | [主要地標](../lib/city/assets/primary-landmarks.ts)、[次要地標](../lib/city/assets/secondary-landmarks.ts)、[地標整合](../lib/city/landmarks.ts) | 既有原創程序幾何與各自材質仍在使用。本輪未把所有地標重新做成完整 Blender 建築或全面更換其材質。 |
| 車輛、公共運輸、船舶、飛行器 | [跑車](../lib/city/assets/roadster.ts)、[巴士](../lib/city/city-buses.ts)、[鐵路](../lib/city/railway.ts)、[船舶](../lib/city/harbour-models.ts)、[飛行器](../lib/city/assets/aircraft-models.ts) | 既有程序模型與專用材質保留；車漆、輪胎、座艙等尚未納入本輪八種表面的統一製作範圍。 |
| 可操控人物 | [Blender 人物來源與規格](../tools/assets/citizen/README.md)、[人物 GLB](../public/models/citizen/vancouver-citizen.glb)、[執行時動畫](../lib/city/citizen.ts) | 已有原創骨架人物、獨立 PBR atlas 及 idle／walk／run。這是既有資產，並非本輪新成果；警員及載入失敗時的替代模型仍有不同製作方式。 |
| 招牌、店面識別、室內 | [店面識別](../lib/city/shopfront-identity.ts)、[室內](../lib/city/interiors.ts) | 既有文字 atlas、代表性店名及室內材質仍分開管理；虛構招牌不可當成真實 POI。共用表面可以提供木／金屬等來源，但不表示室內全數已換材質。 |
| 天空、光照及遠景氣氛 | [氣氛控制](../lib/city/atmosphere.ts)、[天空效果](../lib/city/sky-effects.ts) | 提供不同時間、晴天／陰天的一致觀看條件；材質驗收必須在這些條件下進行，不能以單一夕陽截圖代表全部品質。 |

## 2. 已建立的八種共用表面

唯一的表面定義入口是 [catalog.json](../tools/assets/city-materials/catalog.json)。顏色、實際重複尺寸、粗糙度、金屬度與凹凸尺度在這裡管理，再由[產生器](../tools/assets/city-materials/generate_city_materials.py)輸出 Blender 來源及執行時貼圖。這些是原創數學紋理，屬於代表性建材，並非溫哥華特定建築的掃描或照片貼圖。

| Slot／ID | 重複尺寸（公尺） | 目前主要用途 |
| --- | --- | --- |
| 0 `heritage-brick` | 1.728 × 1.728 | 歷史類型磚牆、店面磚柱 |
| 1 `sandstone` | 1.2 × 1.2 | 低層砌體代表表面、石材窗台／基座／飾邊 |
| 2 `concrete` | 1.5 × 1.5 | 現代建築不透明部分、一般人行道及礦物表面 |
| 3 `cedar` | 1.52 × 1.52 | 住宅外牆及模組中的木質部件 |
| 4 `roof-shingle` | 1.8 × 1.92 | 已有住宅坡屋頂 |
| 5 `street-brick` | 1.92 × 1.92 | Water Street 歷史街磚鋪面 |
| 6 `painted-metal` | 0.8 × 0.8 | 店面模組金屬飾邊、門及遮雨部件 |
| 7 `asphalt` | 3 × 3 | 車道及代表性平屋頂表面 |

六種建築類型的對應如下；這是集中管理的預設表面規則，不是對真實建築用途的判定。

| 立面類型 | 不透明牆面 | 保留的外觀規則 |
| --- | --- | --- |
| `heritage-brick` | 磚 | 歷史店面節奏、樓上窗格及石材細節 |
| `lowrise-masonry` | 砂岩 | 低層窗格及入口尺度 |
| `midrise-grid` | 混凝土 | 中層窗格、玻璃與框架 |
| `balcony-slab` | 混凝土 | 陽台及既有立面配置 |
| `curtain-wall` | 僅不透明區域使用混凝土 | 幕牆玻璃遮罩及反射／發光表現保留，不把整棟玻璃改成混凝土 |
| `domestic-cladding` | 木質外牆 | 住宅窗門配置及來源允許的屋頂形態 |

來源為 [city-material-library.blend](../tools/assets/city-materials/source/city-material-library.blend)，內含八種具名材質及打包貼圖；[source/textures](../tools/assets/city-materials/source/textures)保存 24 張 480 × 480 PNG，[材質板](../tools/assets/city-materials/source/material-board.png)供批次檢視。執行時使用[版本 manifest](../public/materials/city/manifest.json)與三張 1024 × 512 共用 atlas，每個 slot 有 240 像素有效區域及四周各 8 像素循環 padding。

手動修改 `.blend` 材質節點後，可使用 [export_material_library.py](../tools/assets/city-materials/export_material_library.py)重新烘焙共用 atlas；不必把改動翻譯回程式碼。工具輸出到新的工作目錄、保留原始檔，支援這八種不透明 PBR 表面，並拒絕無法保留的玻璃或額外材質效果。操作指令及限制見[匯出說明](../tools/assets/city-materials/README.md)。這條路徑已實測節點顏色、roughness、metallic、normal 與 bump 修改，以及未修改槽位的隔離性。

Base color 使用 sRGB；normal、ORM 使用 non-color；normal 為 OpenGL +Y；ORM 的 R 固定為 1（不烘焙環境遮蔽）、G 為 roughness、B 為 metalness。基底顏色不含預先畫入的日照或陰影。GLB 店面使用相同來源表面另行烘焙，每個 LOD 有自己的物件 atlas，並非直接使用 GIS 的八格 atlas。

## 3. 資料、建築與模組的分工

一般建築保留來源 footprint、分部、基座及高度。`structureId`／`buildingId`／來源 ID（缺少時採穩定的幾何 key）決定外觀種子，同一建築的分部共享設定，避免重排資料就換外觀。材質 slot 表示「這個表面是什麼」，實例屬性表示尺寸、顏色及變化；它們不應偷偷改動地理資料。

可大量重用的窗框、門廳、雨棚、店面 bay 採標準公尺尺寸，再沿符合條件的來源建築邊緣配置、分格及實例化。完整建築 GLB 留給有明確身份、資料和對齊依據的重點地標；不以整棟手工模型全面替代 GIS 城市，否則高度、輪廓、碰撞、載入量及資料更新會脫離共同來源。這是製作原則，並不表示現有地標都已採 GLB。

目前仍有明確的遺留限制：`facade-profile.ts` 的 Gastown 類型選擇及 `streetfronts.ts` 的歷史街面範圍仍使用既有的地圖座標 bounding box（約 x 700–1850、z −70–540），並結合高度等條件。**本輪統一了表面定義，沒有完成所有地理選擇規則的資料化。** 後續應把這類區域集中為具名範圍／街段和來源 ID 規則，附來源與測試；不能宣稱目前已完全沒有地理特例。

日常修正應依「表面角色 → 類型 → 相容幾何 → 資料選擇」進行。若是一條街共同出現材質比例或亮度問題，修改共同規則並驗收整段街道；不要新增只對某個 x／y／z、生效於某一張截圖的補丁。確有地標或資料缺口時，例外須具名、可追溯並限定影響範圍。

## 4. 從盤點到場景驗收的製作流程

1. **定義類別與限制。** 先查上表與 catalog，記錄表面角色、實際尺寸、需要的幾何層級、來源 ID／範圍、LOD 和資源上限。避免同一磚材在牆、柱、雨棚旁出現不同尺寸或光澤。
2. **整批修改 Blender 材質庫。** 調整 catalog／產生器，輸出八種共同表面及材質板；先比較同光照下的色彩、接縫、凹凸和粗糙度，再使用於建築模組。只改生成後的 PNG 或 `.blend` 而未保留相應來源，會在下次重建時丟失修改。
3. **以獨立 LOD 來源製作模組。** 已交付的編輯入口是 [heritage-shop-bay.lod0.blend](../tools/assets/streetscape/source/heritage-shop-bay.lod0.blend)、[heritage-shop-bay.lod1.blend](../tools/assets/streetscape/source/heritage-shop-bay.lod1.blend)、[modern-lobby-bay.lod0.blend](../tools/assets/streetscape/source/modern-lobby-bay.lod0.blend)、[modern-lobby-bay.lod1.blend](../tools/assets/streetscape/source/modern-lobby-bay.lod1.blend)。這些保留烘焙前材質及公尺 UV，可分別修改。預覽用 `streetscape-source.blend` 只含匯回的已烘焙 GLB，不能取代它們。
4. **重匯出與驗證。** `--from-source` 從編輯後的獨立檔案重烘焙，保留其尺寸及 UV，不再重跑壓縮 bay 的幾何變形。驗證材質接線、貼圖通道、hash、GLB 節點、尺寸、三角形及材質數量；來源檢查被跳過時必須明確記錄。
5. **接入同一執行時規則。** [共用材質載入器](../lib/city/material-library.ts)、[表面介面](../lib/city/city-surface-material.ts)與[模組放置規則](../lib/city/streetscape-placement.ts)管理尺度、貼圖準備狀態、地面貼合、淨空及批次。近景 GLB 保持既定人尺度，不以不等比拉伸配滿任意建築；未升級或超出上限的街面仍保留原有細節。
6. **回到完整場景驗收。** 檢視近景牆面與人行道、屋頂、整段街道及不同區域；採相同相機、時間、天氣與畫質設定比較，並確認 LOD 交接、庭院接地、玻璃、路面與光照互相一致。Blender 單體漂亮、atlas 檢查通過，都不能替代瀏覽器內的場景驗收。

以下命令在 repository 根目錄執行；需要 Blender 4.5+，macOS 可將 `blender` 換成實際的應用程式執行檔路徑。第一條重建 repository 中的共同表面；店面重匯出先寫入工作目錄驗證，再將已驗收資產、來源與 manifest 一起發布。

```sh
# 重建共同表面與可編輯 Blender 材質庫
blender --background --factory-startup --python tools/assets/city-materials/generate_city_materials.py -- --output public/materials/city --source tools/assets/city-materials/source

# 由獨立的已編輯 LOD 來源重匯出，保持其幾何與 UV
blender --background --factory-startup --python tools/assets/streetscape/generate_streetscape.py -- --output work/material-reexport --from-source tools/assets/streetscape/source --shared-materials tools/assets/city-materials/source/textures --only-shipping --skip-render

python3 tools/assets/city-materials/validate_city_materials.py --streetscape-source work/material-reexport/source --streetscape-root work/material-reexport --report work/material-reexport/material-validation.json
python3 tools/assets/streetscape/validate_streetscape.py --root work/material-reexport
```

更多參數與通道規格見[材質庫 README](../tools/assets/city-materials/README.md)及[街面模組 README](../tools/assets/streetscape/README.md)。`--skip-render` 只跳過預覽圖片，不表示可省略最後的視覺驗收。

## 5. 驗收條件與資源預算

- **來源與尺度：** 建築輪廓、高度、碰撞及原有道路保持資料來源；店面 GLB 使用公尺、Y 向上、+Z 朝街道，bay 高度不超過 3.2 m。bay 是未挖開 GIS 牆面之前的表面細節，不自動產生可進入空間。
- **材質一致：** 比對材質版本、八種 slot、貼圖 hash、色彩空間、normal／ORM 接線與實際 UV 尺寸；遠處取樣須避免相鄰 atlas 格混色。執行時三張共同貼圖都準備好才進入材質對照截圖；失敗時使用可辨識的平均色回退，不把未載入畫面當成正式結果。
- **模組上限：** High 最多 4 cells／24 bays／6 個 LOD0；Ultra 最多 6 cells／36 bays／10 個 LOD0；快取 12 cells、每 frame 組裝 1 cell。其餘可見 bay 用 LOD1。兩種 bay 的 LOD0／LOD1 分別為 heritage 8,128／604、modern 6,260／556 三角形；最多三種材質。這些是現行預算，不是無限擴充的理由。
- **庭院與植栽：** 庭院最多 500 個來源 plot、每 plot 2 個土床，整體三角形硬上限 38,000；按實際地形三角形裁切，排除道路、人行道、鄰棟及入口。QA 同時記錄實際數量與來源例子，不以測試平地的數量冒充正式場景數量。樹木不得因增加 Ultra 細節而改變主要枝幹位置。
- **記憶體：** 三張共同 1024 × 512 貼圖以未壓縮 RGBA 加 mipmaps 估算約 8 MiB；這只涵蓋共用材質庫。店面物件 atlas、人物貼圖、樹葉、陰影及其他場景資源另外計算，不能把 8 MiB 寫成全城材質用量。
- **完整場景：** [升級 QA](../lib/city/upgrade-qa.ts)保留相同街面／屋頂相機，在晴天及陰天各比較 14:00、19:00、19:48、23:00，並記錄區域庭院及共用材質準備狀態。[持續行走 QA](../lib/city/upgrade-endurance-qa.ts)觀察連續使用、快取與資源變化。畫面品質、frame time／FPS、draw calls、三角形及記憶體需分開報告；本文件不預先宣稱效能改善幅度。

## 6. 下一階段優先順序

1. **把地理選擇規則集中管理。** 將遺留 Gastown bounding box 改為有來源的具名街段／範圍及建築 ID 規則；先保留現有結果作對照，再移除重複判斷。
2. **擴充同一套近景建築部件。** 依庫存缺口製作窗框、窗台、轉角、簷線及住宅入口等可重用模組，先在完整代表街段驗證輪廓、接縫與 LOD，再擴大配置。現有 bay 的共同材質與編輯流程是基礎，並不代表這批新幾何已製作完成。
3. **補齊尚未統一的材質類別。** 依視覺收益及資源成本排序樹皮／葉片、土壤／草地交界、地標特殊建材及車輛表面；水與人物保留必要的專用渲染。是否共用 atlas 應由取樣方式與資源需求決定，不能為統一而塞進不適合的八格表面庫。
4. **用同一驗收條件逐批交付。** 每批一併保存 catalog、產生器、Blender 來源、最終資產、manifest、來源檢查及場景比較。只把通過整合驗收的批次列為完成；上述待辦是方向，並非本輪已交付功能。

建築類型研究沿用 repository 已採用的官方參考：[Gastown Heritage Management Plan](https://vancouver.ca/files/cov/gastown-heritage-management-plan-2001.pdf)、[Gastown HA-2 Design Guidelines](https://vancouver.ca/files/cov/gastown-ha2-design-guidelines.pdf)與[Central Area Pedestrian Weather Protection](https://guidelines.vancouver.ca/guidelines-central-area-pedestrian-weather-protection.pdf)。它們提供街面、窗框、簷線及遮雨設計的類型知識；未複製其中圖片，也不構成特定建築已精確重建的證據。
