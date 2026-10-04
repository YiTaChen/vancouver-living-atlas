# 開發需求基礎庫存與來源契約

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)

## 這一包完成什麼

完成 2026-10-03 待開發清單的第一步：把 **A01–F05 全部 27 個需求**對應到實際既有來源、套件、穩定 asset IDs、現行 consumer、歷史證據與未完成工作。這是基礎盤點，不是 27 項需求的模型或 runtime 完成報告。

來源固定為 main 基準 `5574d55719f10d1575127d8b92cbd23ff71e446f`。原需求文件內較早的 `614cf841…` 另列為文件基準，不把兩者混用。後續工作分支的 commit 可以前進；驗證器要求原來源 commit 為 HEAD 祖先，且所有列管來源檔仍與原 commit 的 Git blob 相同。**同批稍後製作的其他新包不屬於這份基準庫存**，應以其獨立 manifest／handoff 記錄結果，不覆寫此來源快照。

本次重新讀取並驗證：

- 9 組既有套件，53 筆原 manifest asset／surface／role 記錄
- 436 個來源、輸出、consumer、資料及證據檔：逐檔 SHA-256、實際 bytes、基準 Git blob
- 63 個實際 GLB：重新跑標準庫容器／索引／有限值檢查，讀取 triangle／primitive／匯出 position vertices／skin／animation 與內嵌 image bytes
- 16 項尺寸、原點、淨空、語意與時間契約：JSON pointer 值或實際來源片段必須仍吻合
- 15 項正反向回歸：需求遺漏／重複、假完成、錯誤 asset reference、datum 漂移、hash 變動、重複路徑與越界等

`fingerprintedDiskBytes` 是上述列管檔案的磁碟總量，包含地理資料、來源及歷史預覽，不是模型下載量或 runtime residency。53 筆記錄也不是 53 個完整新模型。

## 檔案與使用方式

- `requirements.json`：人工審閱的 27-ID 對照；每項獨立列出 offline／runtime scope、現有狀態、consumer、缺口與證據。
- `package-catalog.json`：既有套件根目錄與原 manifest adapter。**沒有改寫或升版任何舊 manifest。**
- `datum-contracts.json`：機器可檢查的既有尺寸／datum 例外與來源，不把代表性提案當作現實測量。
- `inventory.json`：由實際檔案生成的完整快照，包含上述資料、原 manifest 記錄、逐檔 hash／大小、GLB 檢查、重複 PNG 身份及 citizen 採用核對。
- `inventory.py`：預設只讀並與快照逐欄比對；僅指定 `--write` 才重建本目錄的 `inventory.json`。
- `test_inventory.py`：標準庫回歸測試。
- `qa/validation.json`：本次實際執行的命令、環境、exit code 與輸出；不是 Blender／WebGL 報告。

從 repository 根目錄執行，不需 npm 套件或 Blender：

```sh
python3 tools/assets/development-backlog/inventory.py
python3 -m unittest discover -s tools/assets/development-backlog -p 'test_inventory.py' -v
```

經人工核對 mapping／datum 改動後，可明確重建：

```sh
python3 tools/assets/development-backlog/inventory.py --write
```

基準來源若已變更，命令會拒絕，不會更新舊包、改 hash 來掩蓋差異或從新版 HEAD 靜默換來源。未來要盤點另一個來源 revision，應建立具名新版本，保留這份證據。

## 需求到現有入口的速查

| ID | 既有來源／主要 consumer | 還缺什麼 |
| --- | --- | --- |
| A01 | GIS、city-materials；building-bodies／facade-profile | 新來源規則或 material-role 改善及樣區驗收 |
| A02 | 地形／海岸；vegetation_ground slope studies | 真地形表面 consumer，研究 coupon 不可鋪滿城市 |
| A03 | water-waves／atmosphere／sky／clock | 新 renderer 變更及實際 WebGL 驗收 |
| A04 | bridges／railway／rail-path／harbour-path | 有依據的局部結構件；展示路徑不是搭乘服務 |
| B01 | architecture-plan；modern-parapet-cap | 新屋頂設備及壓頂 fit／排水契約 |
| B02 | city-materials；building-surface-palette | 必要礦物／膜材 PBR，不能冒稱逐棟材料資料 |
| B03 | procedural tree geometry；12 sprig studies、leaf QA | 成年模板、合理葉簇、meter UV／alpha／height normalization |
| B04 | Waterfront interiors、Marine entry、landmark roles | 地標入口局部件，保留外殼及 collision |
| C01 | 8 類 architecture-details、heritage bay | 來源 opening／floor 適配；Robson fitted candidate 另列 |
| C02 | 5 類 modern expansion、modern bay | 通用 fit；24 窗台 QA 不等於全城採用 |
| C03 | 住宅入口、3 類 cedar expansion | opening／坡地契約；保留 canopy ground origin |
| C04 | road／residential ground、city maps／ground studies | 公尺 UV、真實地面取樣、受限 edge consumer |
| D01 | shelter generator、SeaBus／SkyWalk 空間 | 站點／月台／station-layout 與來源入口 |
| D02 | city-buses 程序外觀、role maps | 中空外殼、獨立門輪、共用 vehicle root |
| D03 | role-material coupons；無現有公車車廂 | 真正分段 floor／座席／扶手／乘坐 anchors |
| D04 | railway 程序 metro／wheel sampling | 首尾中間車、可開門外殼、coupler frames |
| D05 | role maps；無現有 metro 車廂 | 內裝、可走 gangway 與 moving clearance |
| D06 | bus／railway／navigation／clock | 連續服務、停靠、門、rider state、上下車與錯誤恢復 |
| E01 | environment body＋cabin boxes | 共享轎車／SUV 模型及 LOD，保持人口與路線 |
| E02 | roadster 程序曲面、role maps | meter UV／真正座椅 roles，不能按 leather 名稱替換 |
| E03 | harbour／aircraft／cockpits | 有證據才補局部；保留動力學與控制 datum |
| E04 | interiors／seabus-layout、role maps | Parts UV／roles；保留 floor、活動與通道 |
| F01 | streetscape lamp／bench／shelter generators | 獨立可編輯來源與 GLB LOD，重新量測 |
| F02 | 現有 environment／ground placement 入口 | 新 bins／hydrants／racks／bollards 及來源位置 |
| F03 | 7-triangle perennial、source gardens／ground studies | 保持人口／footprint，正確使用 edge sampler／weight |
| F04 | citizen optimization／production LOD0、traffic-stop | LOD1/2 selector／fade／residency、rig-compatible 變體 |
| F05 | 8 city surfaces＋8 role materials／24 maps | consumer UV／語意角色及正式樣區接入 |

精確 stable ID、LOD 路徑、材質角色及個別證據以 JSON 為準；表格不取代原 package 的 validator。

## 必須保留的現況差異

1. **Citizen LOD0 已是正式檔案。** 本次直接對比 public GLB 與 optimization LOD0，兩者 SHA-256 同為 `14d66fabe097abf82ef36800561c06ee7263c0acfd6b5ea1265a40ed35841ff8`。現行 loader 使用此 cache key。舊 manifest 的 `runtimeIntegrated=false` 與舊 production source path 是歷史記錄，不能覆蓋現在的 consumer 證據。
2. **Authoring 與 exported vertices 不相同。** 本次從 GLB POSITION accessor 讀取 citizen LOD0 為 29,063 vertices／37,799 triangles；manifest 的 authoring 記錄保留原值，不默改舊文件。頂點計數是 unique POSITION accessors 之和，並非畫面 instance／GPU 多 pass 數量。
3. **16 類建築細節有來源，不代表全部採用。** 納入 8 歷史＋8 現代／住宅類；另有 Robson 專用 fitted candidate。兩個 bay 是既有 shipping 資產；現代／cedar 窗台只保留具名來源 QA。
4. **枝條不是成年樹。** 約 1.25 m 級研究身份與 manifest 的 1.2 m 幾何高度各自明列；不能放大冒充成熟市政樹。新 10 m 模板必須用 sourceHeight／templateHeight，不能再乘來源高度一次。
5. **傢具 generator 不等於已交付資產。** heritage-lamp／cedar-bench／transit-shelter 已有 builder，但 shipping manifest 只有兩個 bay；名義尺寸不能宣稱為本次重匯出量測。
6. **交通仍是展示模型。** 沒有新增 interior、station layout 或 rider state。公車舊 ground+1.08、metro rail-relative wheel datum 不能當新 floor 高度。
7. **原點與角色比外框更重要。** 雙坡雨棚 Ymin=2.36，入口淨空1.04×2.30；bay depth 含 canopy。Roadster 的 leather 是駕駛頭部、座席在 dark；interiors 與 roadster 目前會移除 UV。

## 驗收界線

本次只有來源檔完整性、JSON 契約對照與 GLB 容器資料檢查。沒有啟動 Blender、重開／重匯出來源、Cycles render、重新量 bounds／opening／collision、瀏覽器 WebGL、GPU、FPS、全城或手機測試。歷史報告只以 hash 與路徑保存身份，不改成這次 pass。

GLB `embeddedImageBytes` 是實際 image bufferView payload，`containerNonImageBytes` 是 GLB 總 bytes 減它，**仍包括 JSON、animation、skin、padding**，不是純幾何 GPU buffer 大小。PNG hash 去重只計外部 map 檔磁碟成本，不含內嵌圖像去重、mip residency 或 VRAM；不從檔案大小推定效能。

所有 27 項的新工作仍分列 `planned`／`runtime_pending_webgl`，新 Blender／WebGL checks 為 `not_run`。不觸碰既有 `public/`、runtime、主規格、地理資料或發布流程；本次未執行部署。
