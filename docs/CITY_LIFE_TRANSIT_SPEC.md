# Vancouver Living Atlas 城市生活與公共運輸待開發規格

日期：2026 年 10 月 4 日，America/Vancouver。版本：1.0。狀態：**待開發**。對象：Vancouver Living Atlas 的資產製作與程式整合 agent。

本規格讓城市在近距離更有生活感，並提供區域內可搭乘的溫哥華公車與 SkyTrain，同時保留全城、天際線、遠景、步行、駕車、船與飛行的探索能力。城市視角仍是核心體驗；行人、站體與車內細節是逐層出現的內容。

依上一輪建議，納入第 2 至第 4 點的交通成本控制、局部活街、連續交通路徑與玩家上下車交接。**第 1 點的獨立效能基準工程先不排入；本期也不以縮短城市視距、移除遠景或全面重建基礎城市幾何為工作前提。** 實作仍須完成相關功能、畫面與資源生命週期驗收。

本次只建立規格；下列行人、交通服務、站體與搭乘能力都不能標為已完成。夜間照明構想全部標為 **deferred 暫不實作**，不屬於本期開發或驗收。

## 現況與文件關係

程式盤點基準為 [main 5574d557](https://github.com/YiTaChen/vancouver-living-atlas/tree/5574d55719f10d1575127d8b92cbd23ff71e446f)。開發前重新核對 HEAD，將差異記入交接，不把舊盤點當成當時程式現況。

沿用 [既有開發清單](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/docs/AI_AGENT_DEVELOPMENT_BACKLOG.md) 的資產格式、公尺尺度、座標、材質角色及 D01 至 D06 交通交接契約。本規格補充人口、服務路徑、區域站點、站體與驗收條件，不重複建立另一套不相容 manifest。建議在 repo 保存為 `docs/CITY_LIFE_TRANSIT_SPEC.md`，由主開發清單連結本文件。

| 項目 | 盤點現況 | 本期新增或改善 |
| --- | --- | --- |
| 城市視角 | 有全城 Orbit、遠景、飛行及多種地面模式 | 保留整體城市；按視距啟用人口、車內與站內細節 |
| 行人 | 有玩家 citizen，沒有一般街道人口系統 | 原創低成本背景行人、少量互動角色、近距離生活反應 |
| 汽車與公車 | 有展示模型與移動；普通車及公車主要沿獨立直線路段循環 | 局部連續車道、轉彎與停靠；可搭乘公車使用持續的服務身份 |
| SkyTrain | 約 855 與 894 m 的兩條裁切高架展示段；端點淡出重生；聚焦列車只是相機功能 | 另建含站點、地下及高架區段的可搭乘服務，與展示軌道分開辨識 |
| 車廂與車站 | 已有代表性公共室內與待製作交通資產規範 | 可開門的空腔車廂、合法上下車錨點、各站入口與必要內部 |
| 日夜 | 有日夜、環境光、部分 emissive 素材 | 夜景只列構想，本期不調曝光、不新增燈光功能 |

現況來源：[專案規格](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/docs/PROJECT_SPECIFICATION.md)、[交通搭乘待辦 D06](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/docs/AI_AGENT_DEVELOPMENT_BACKLOG.md#67-d06由整合agent完成搭乘新runtime不是建模完成即完成)。

## 開發範圍與保留條件

| 需求 | 狀態 | 本期交付 |
| --- | --- | --- |
| 城市與交通成本控制 | planned | 普通交通按區域選擇及低頻更新；近景內容有限額；保留全城輪廓與交通概況 |
| 近距離行人 | planned | 2 至 3 個街區樣區、共享低模、距離分層、局部路徑與簡單反應 |
| 載具身份交接 | planned | instance 與詳細載具表示切換，車輛及玩家身份持續，安全上下車 |
| 公車搭乘 | planned | 先驗收一個有限服務循環，再擴展 5／6；靠站、開門、上車、乘坐、按鈴、下車 |
| SkyTrain 搭乘 | planned | 先驗收兩站，再擴到範圍內 Expo 與 Canada Line 站點；不同車型與站體接口 |
| 夜間店面窗戶與路燈 | **deferred 暫不實作** | 只保存構想與資料來源；不得納入本期程式、模型製作或上線工作 |

全城視圖維持現有地理範圍、地標、地形、道路與天際線。拉遠時可以換粗略表示，但城市不得出現空洞、大片消失或可辨識地標被人口預算牽連關閉。不得用減少相機 far plane 作為本規格的驗收捷徑。

本期不另建立全城建築分塊或地形重構專案。若未來另行處理，必須同時提供完整遠景表示，並保持 GIS 與碰撞資料契約。現有樹、facade、shop bay、陰影及環境反射的快取與距離控制應沿用。

SeaBus、West Coast Express、地圖外站點、完整票價系統、即時班次 API、大型對話樹、機車玩法及犯罪追捕不列為本期必要交付。載具交接接口可以支援未來車種；本期生活反應先採讓路、停等、看向事件及候車。

## 城市視角與資源啟用規則

### 相機與角色位置分開處理

遠景相機只是觀察位置，不代表玩家搬到該位置。搭乘中切換 Orbit，玩家仍留在同一台車、同一節車廂及同一座位或站立區；介面提供返回乘坐視角。從 Orbit 切回不能重新生車、換路線或重置進度。

城市遠景保留低成本車輛外觀及服務位置；車內、站內及街道行人只在近距離需要時顯示。低空 Orbit 靠近街道時也能看到行人，不能僅因 mode 名稱是 Orbit 而一律隱藏。高空或全城視點不生成整個城市的人口。

啟用中心分為相機街景中心、玩家所在位置及玩家正在搭乘的服務。以相機高度、三維距離和畫面大小控制渲染；以玩家附近、必要交互及服務狀態控制模擬。地表行人不因距地下相機很近，就穿透天花板顯示在站內。

### 更新與顯示分離

- 普通背景車：保存路徑站距、速度、佔用與等待狀態，較遠區低頻推進；每幀對可見車輛插值，無須每車每幀查地形或寫矩陣。只有沒有排隊或交互影響的純展示車可依時間解析位置；受交通控制的車不能以 elapsed time 重算而跳過停線。
- 載客公車及列車：服務持續有效，不受相機距離剔除而停駛或消失。詳模可降級，但乘客座標、合法地板與必要車門接口不可被回收。
- 行人：外觀細節、動畫、AI 決策、碰撞各有自己的範圍。隱藏或降低模型不代表刪除互動角色的進度。
- 資產：共用 geometry、材質與貼圖；內裝按需載入；回收 instance、actor 與詳細表示時明確記錄共享資源所有權。資產失敗保留展示 fallback，沒有可用內裝時不得允許登乘。

所有距離與數量是下文的**起始提案**，不是台北的實測預算或已證實的效能提升。整合後可依畫面調整，但不能取消全局上限與遲滯。

## 低成本行人與局部活街

### 借鏡台北的方式

台北公開部署採多數人物批次繪製及 shader 動畫，少數近距離人物升級為骨架模型；在該版 medium 設定中，真實近景 avatar 額度為 7，升級與降級距離為 12 與 15 個遊戲世界單位，完整動畫更新額度為 2。這說明外觀、動畫和反應可以分層，並不表示我們需要複製相同人口或距離。

來源是 [actors 部署 bundle](https://taipei-gta.vercel.app/assets/actors-Cceq-zXJ.js)，沒有找到可信的對應開源 repo。這是部署版本的程式觀察；台北的世界單位不能直接當作 Atlas 公尺。Atlas 只借鏡原理，模型、shader 與玩法獨立製作。

### 行人資產交付

背景行人另建新包，不複製目前約 37,799 triangles 的玩家 citizen 作為數十人的預設。現有玩家角色的 LOD2 仍約 27,531 triangles，不能作為本規格的廉價遠景人物。[既有角色量測與整合紀錄](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/docs/OFFLINE_ASSET_INTEGRATION_2026_10.md)

| 層級 | 建議幾何及動畫 | 用途與限制 |
| --- | --- | --- |
| 中距離背景人 | 每人 300 至 1,000 triangles；合併身體、簡單頭部及四肢；rigid limb 或共享 shader 步態 | 主要街道人口；共享 geometry 與配色，避免每人一個 AnimationMixer |
| 較遠背景人 | 每人 80 至 250 triangles；簡化輪廓或少量姿勢 | 接近隱藏距離時保留輪廓；不投動態陰影 |
| 近距離互動人 | 每人 1,500 至 5,000 triangles、8 至 16 bones；少量共享 clips | 少量面對玩家、指引或候車角色；不以全身高精度裝備堆細節 |

這些是製作目標；驗收以實際匯出計數為準。首包提供至少 4 種原創輪廓，透過衣服配色、身高、帽子、包與步態形成變化。避免每人獨立 1024 貼圖；優先 vertex color，或共用一張 512 至 1024 atlas。貼圖下載量與含 mip 的 GPU 估算分列。

1 unit 等於 1 m；腳底 datum、朝向、坐姿 pelvis 錨點、碰撞 capsule、LOD 原點保持一致。必備 walk、idle、look、yield，互動款另有簡化指引與坐姿。角色身高提案為 1.55 至 1.95 m，必須能通過現有及新交通空間，不以非等比縮放配合門口。

使用 InstancedMesh 加共享 shader 為首個可用方案；如採 BatchedMesh 或 vertex animation texture，須有不依賴 multi-draw extension 的 fallback，並列出 VAT 貼圖成本。不要在首版同時引入多個人物渲染後端。

每種輪廓與 LOD 使用一份合併 geometry、單一 opaque material；帽子與包以同批幾何或 shader 變體表達，不逐人新增 Mesh 與材質。4 種輪廓乘 2 個背景 LOD 對應最多 8 個背景主 pass 提交。GPU 動作同步處理 normal、AO／normal pass 及啟用時的 depth pass，animated bounds 覆蓋手腳擺動，避免正常移動被裁掉。背景人不投動態陰影；若使用接地光斑，另列幾何與透明提交成本。

### 出現距離與人口額度

| 規則 | compatible 任意畫質 | desktop Balanced | desktop High 或 Ultra |
| --- | --- | --- | --- |
| 全 runtime 活動人物總數 | 12 | 24 | 32 |
| 其中互動角色 | 最多 2 | 最多 3 | 最多 4 |
| 近距離骨架人物 | 最多 2 | 最多 3 | 最多 4 |
| 近景骨架升級與降級 | 進入 10 m，退出 14 m | 進入 12 m，退出 16 m | 進入 12 m，退出 16 m |
| 地面近景人口選擇半徑 | 60 m | 90 m | 100 m |
| 背景人最遠可見距離 | 80 m | 110 m | 120 m |

這是所有樣區、相機、玩家與搭乘服務中心取聯集後的共享上限，不能各自生成 32 人。互動、候車、站內與升級人物全部包含，玩家角色另計。compatible 是 runtime 能力 profile，優先採低額度，即使 UI 選 High 也不突破；desktop Ultra 先共用 High 上限。

每人有穩定 actorId，與 instance slot 分離；升降級保留輪廓、衣色、路徑站距、動畫 phase 與互動狀態。額度不足優先保留玩家即將交互與合法避讓的附近角色，再選相機可見背景。遠處任務身份可保留輕量 state，不無限 pin 詳模。約 30 至 60 m 改用粗略輪廓；超出可見距離不畫。高空全城視點停止新增街道人口。

每項切換使用遲滯，例如離開人口選擇圈再多 20 m、持續 3 秒才回收。出生須在視線之外、遮蔽處或視距邊緣；使用短淡入或 dither 過渡，不能在玩家面前突然冒出一排人。同一視點小幅移動不重抽整街身份。

### 路徑與反應

首批選 Robson 或 Waterfront 相鄰的 2 至 3 個已有來源街區。人行道、廣場、候車區及站內各有 surface ID；先準備可走路徑並採樣高度與淨空，運行時更新站距與插值。不可每人建立完整 Navigator，亦不可沿汽車中心線假裝走在人行道。

樣區提供走動、停等、看店面、坐椅子、候車及進出站中的少量組合。狀態為 `walk → wait/look/yield → resume`，事件只通知附近空間格內的角色。近人物移動提案為 20 Hz、AI 決策 5 Hz；較遠人物移動與決策 1 至 2 Hz；每幀只插值可見姿態。骨架動畫另有少量完整更新額度，不能把移動、決策、動畫與碰撞全塞進每幀。

近碰撞使用同層 spatial bins；提案只啟用玩家 35 m 內最多 12 個簡單 capsule，其餘以路徑與 soft yield 避讓。危險或必要交互可即時喚醒，事件須去重並有 cooldown。所有 tick 使用與暫停一致的模擬時間，限制 catch-up，避免分頁返回一次做大量更新。

首版道路穿越只用已驗證的人行穿越點與明確停等規則；未建成交通控制的路口不生成過街人。簡單反應包括玩家靠近時避讓、車輛靠近穿越點時停等、喇叭時短暫看向聲源、公車到站時走向候車位置。沒有安全下個點就等待，不能穿牆、走入水面或切到另一層地板。

候車 NPC 首版可以只在站外活動；不假裝已有完整乘客上車。後續若增加 NPC 搭乘，也須使用同一服務與乘客契約，不另外做穿門動畫替代真上下車。

樣區安排 2 至 4 個簡短互動身份，例如路線指引、候車乘客或街角活動角色。先串接一個 2 至 5 分鐘的既有城市觀察活動，不建立經濟或大型劇情系統。搭乘不能自動滿足原本要求實際步行的手帳 gate。

## 連續車流與載具交接

### 局部連續交通路徑

普通交通先在樣區與公車服務沿線建立有向 lane path、junction connector、停線、合法轉向及路面身份。沿用來源道路與現有高度索引，但另準備交通拓撲；目前 street graph 的 `nodeIntersections:false` 不等於可直接使用的完整路口網路。

每段保存來源 ID、長度、累積站距、方向、速度上限提案、地面或橋面身份，以及下一段。轉彎保持位置與朝向連續，不在路段結尾瞬移回起點。橋面、地下及地面交叉不能因 XZ 相交而互相連通。

首版車輛使用簡化跟車、停止線、路口衝突與玩家附近障礙檢查，無須全車隊剛體模擬。公車與普通車在停靠及排隊時使用一致的佔用規則，避免公車停站但車流穿過車身。若候車服務卡住，保留狀態並等待或在合法位置暫停，不得穿越行人或重生解決。

普通背景車可在相機附近約 120 m 更新控制，約 120 至 400 m 低頻更新並插值；更遠保留城市概況與低頻路徑狀態。回到近區沿同一 ID 與合法路段接續，不取消原有停等。距離為提案，低頻不允許可見車輛明顯頓跳。**載客車不屬於可任意淡出重生的背景車。**

### 固定身份與控制權

每台車有穩定 `vehicleId`、`representation`、`simulationAuthority`、`serviceId` 與 `occupancy`。外觀、模擬控制權與乘客佔用是三個分開的狀態；幾何 instance slot 只是當時的繪製位置，不能當作車輛身份。詳細載具升級、返回低模及進出視距都沿用同一 ID。

表示切換及登乘使用 `reserve → preload → validate → commit` 交易，完成前保留舊有效表示；取消、逾時、載入失敗回滾，過期 callback 以 generation token 忽略。commit 原子同步姿態、速度、path station、門與佔用；同一 ID 始終只有一份 authoritative pose、有效碰撞體與座位佔用。降級保持時間與狀態，正在上下車或載客的必要接口不被 LOD 移除。

公車與列車升級詳模或有玩家登乘，仍由同一服務控制器駕駛，不把玩家乘坐當成接管駕駛權。只有允許接管的一般汽車才發生 controller authority 移交。不能先刪舊 slot，再等待新物件成功。

本期先透過公車與列車完成乘坐交接。若接入一般汽車上下車，只選允許互動且停妥的車；搶車、警方與犯罪事件不附帶進本期範圍。

## 區域公共運輸資料與服務

### 地圖範圍

目前 core 為經度 −123.165 至 −123.095、緯度 49.267 至 49.315，約 5.08 × 5.34 km 的矩形包絡，包含水面。周圍低精度 context 不是可搭乘服務範圍。來源：[專案地圖規格](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/docs/PROJECT_SPECIFICATION.md)。

SkyTrain 站點以 [City of Vancouver 站點資料](https://opendata.vancouver.ca/explore/dataset/rapid-transit-stations/map/) 與 [本次官方座標 API](https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/rapid-transit-stations/records?limit=100) 核對是否在界內，線別與入口以 TransLink 官方圖確認。站點 point 只用來選站與初步定位，不能作為月台精確中心、入口位置或完整站體的測量。

| 範圍內站名 | 線別 | 站體工作 |
| --- | --- | --- |
| [Waterfront](https://infomaps.translink.ca/system_maps/skytrain_station_maps/waterfront_station.pdf) | Expo 及 Canada Line | 兩組線別專用月台、方向、門對位與行人轉乘路徑；複用現有代表性大廳需重新驗證連接 |
| [Burrard](https://infomaps.translink.ca/system_maps/skytrain_station_maps/burrard_station.pdf) | Expo | 地面入口、垂直動線、地下候車月台及必要通道 |
| [Granville](https://infomaps.translink.ca/system_maps/skytrain_station_maps/granville_vancouver_city_centre_station.pdf) | Expo | 地面入口、地下垂直動線、月台及必要通道；不憑平面距離接成 Canada Line 同月台 |
| [Stadium–Chinatown](https://infomaps.translink.ca/system_maps/skytrain_station_maps/stadium_chinatown_station.pdf) | Expo | 街道出入口、upper Beatty 與 lower Pacific 的不同高度、月台與路線銜接空間 |
| [Main Street–Science World](https://infomaps.translink.ca/system_maps/skytrain_station_maps/main_street_station.pdf) | Expo | 高架站外觀、入口、上下樓動線、月台、軌道及站外人行連接 |
| [Vancouver City Centre](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/vancouver_city_centre_station_elevator_map.pdf) | Canada Line | 街道入口、地下站內空間與月台；商場接口先只做必要連接 |
| [Yaletown–Roundhouse](https://infomaps.translink.ca/system_maps/skytrain_station_maps/yaletown_roundhouse_station.pdf) | Canada Line | 地面入口站體、地下動線、月台與街區人行連接 |

Waterfront 是 1 個站名，但兩條線各有獨立站內服務節點，不能以同一高度與列車模板代替。Olympic Village 的市府站點緯度約 49.266340，位於南界外，本期排除；VCC–Clark 亦在界外，沒有本期 Millennium 站點。以上判定是本規格以 [市府座標](https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/rapid-transit-stations/records?limit=100) 和 core 邊界計算的結果。

### 資料契約

公車以 TransLink 靜態 GTFS 的 routes、stops、trips、stop_times、shapes 選路線與方向，保存資料日期、hash、stop ID 和 shape ID；若無某 shape，明記來源與人工補線，不用兩站直線取代街道。GTFS 的 `stop_id` 與乘客看到的五位數站牌碼 `stop_code` 必須分欄，例如 Burrard Station Bay 1 在本次 feed 中是 stop_id 8535、站牌碼 50043。來源：[TransLink 開發資料](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources)、[官方靜態 feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip)。

GTFS 座標可供站點與路線平面定位，不能提供精確門口高程、車道側別、平台高度或地下軌道深度。這些須由官方站圖、現有 GIS 和另行建模契約補齊。不要硬編當天班次或宣稱實時抵達。

服務 manifest 至少包含穩定 service/line/direction/vehicle profile IDs、ordered stops、path station、surface/level、停站方向、月台或站牌 ID、門側、允許上下車區、模擬班距、端點策略、資料來源與 approximation 欄。`sourceStopId` 與本專案 service stop ID 分開，避免資料更新改號使已保存的乘坐身份失效。

本次核對的 feed 為 `26SEP_20261002`，標示有效期 2026-09-07 至 2027-01-03；開發時另存實際採用版本，不能把更新日期當作服務生效日期。SkyTrain 有 7 個 station entities、8 個 station×line 組合與 16 個本次方向月台 stop records。Waterfront 的 Canada 平台資料為 P4/P5，不硬套 Expo P1/P2；其 parent 下還有 SeaBus／WCE 等 child，須由 routes、trips 與 stop_times 核對線別。來源：[官方 GTFS](https://gtfs-static.translink.ca/gtfs/google_transit.zip)。

本期不收費；票閘以原創可通行遊戲區處理，不製作付款。使用資料時保留 source attribution 與官方要求的資料 legend 位置，依 [當期 GTFS 來源條款](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data) 核對文字，交通地理資料與官方商標使用分開處理。

### 建議服務與分階段範圍

公車首選 **5 Robson 與 6 Davie 的區域服務**，便於連接街景樣區與市中心。本次官方 feed 的代表性工作日路徑與停靠點均在 core 內，並有車輛從 5 銜接 6、從 6 銜接 5 的 block 記錄，可用已核對的動線做連續服務，不在 Davie／Denman 硬加不存在的 U-turn。這是靜態資料快照，不是即時班次。正式 stop IDs、方向和停靠側由所採用的當期資料決定。若選用車型缺少 trolley 外觀，須標為 Atlas 代表性車輛，不宣稱精確復刻該路線車隊。[TransLink Downtown 地圖入口](https://www.translink.ca/schedules-and-maps/transit-system-maps)、[官方靜態 feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip)

首批公車先交付一個有合法回程的服務循環，至少 3 個有效站點、可在其中 2 站上下車；最終沿 5／6 所選各方向的官方 shape 納入全部 core 內有效站點。不同方向使用不同 shape，不把一條線倒放。每站可先使用共享站牌與合法候車區，少量樞紐才增精緻候車亭，無須每站獨立 GLB。5／6 改變 destination 與服務身份時，車輛及車上乘客身份保持不變。

SkyTrain 先做 Expo 的 **Stadium–Chinatown 至 Main Street–Science World** 兩站服務，驗證站台、高架城市景觀與搭乘。再擴展至 Waterfront、Burrard、Granville，形成範圍內 5 站序列。Canada Line 使用獨立 profile，完成 **Waterfront 至 Vancouver City Centre 至 Yaletown–Roundhouse** 的 3 站序列；其車廂不能直接用 Expo 四節模板替代。

兩站示範是中間交付，**完成本規格須擴展到上述範圍內站點及 Waterfront 轉乘**。地下 path 可以先採有來源的代表性高程與合理曲線，明記精確度；不能照地表地形加固定 clearance，亦不能把地下列車畫成穿越市中心樓房的高架。

### 區域端點

公車與鐵路只模擬 core 內服務；路線畫面標示「區域內模擬服務」，並可列下一個範圍外方向，不允許玩家搭到尚未建立的站。範圍內最後一站作為模擬端點，這不宣稱它是真實營運終點。

載客服務在最後一站正常停靠、開門、提示本區終點，讓玩家下車；若選擇留在車上，服務停妥後可沿已建的合法反向 path 發起回程。SkyTrain 的雙向列車可以切換行駛方向與 destination；公車須有真實可用的回轉或調度連接。沒有合法回程時暫停載客服務，不能瞬移車與乘客。

鐵路反向需有明確 track、block 佔用、方向、停靠側與 service stop 契約，不只是翻轉 path 或改 destination。區域邊界站不一定有真實折返設施，不虛構該站存在 crossover；若現有軌道與調度不支援載客回程，停妥提示下車，待空車不可見後才回收，再於另一合法服務方向調度新列車。區域模擬調度與真實營運終點分開標記。

只有空車、玩家看不見且所有交接結束後，才允許回收或調度新車。背景展示線可保留原淡出效果，但必須與可搭乘服務分別標記，避免玩家對所有經過車輛得到虛假的登乘提示。

## 公車與 SkyTrain 搭乘行為

### 共用狀態

```text
服務狀態
行駛 → 接近站點 → 停妥 → 開門 → 停留 → 關門 → 離站

玩家狀態
步行 → 上車中 → 坐定或站定 → 乘坐 → 下車中 → 步行

相機狀態
乘坐視角 ↔ Orbit 或城市觀察
相機切換不改變玩家乘客狀態
```

服務使用實際 elapsed time，與現有 300 倍日夜時鐘分開。隱藏分頁暫停或有界恢復；返回時不能一次推進很大 dt 把玩家甩出、越站或移到地圖外。模擬班距與停留是遊戲設定，不宣稱官方時刻表。

登乘必須同時符合車速已降至停妥門檻、正確站點、門開、月台或路緣對位、登乘區淨空及支持載客的模型已就緒。只在 UI 顯示「可以上車」仍不足以允許交接。玩家站在軌道另一側或隔牆位置不能靠距離觸發登乘。

停妥門檻的起始提案為速度 ≤0.05 m/s 且持續 0.5 秒；互動距離先以有效門口 2 m 內配合同層與無阻擋條件。停留先 8 至 12 秒，若有人正在交接則延長到完成或安全取消。這些是遊戲參數，不是官方行車規定；所有參數集中配置，不散落在車型程式。

玩家位置保存為 vehicle/car-local transform；車輛轉彎、坡度和減速作用在車輛 root。第一版支援固定座位或固定站立錨點與自由看向；這不等於可在行駛中自由走動。整合通過後再加入受地板與碰撞約束的自由車內步行。佔用者相機與地板保留所需模型層級，不能因全城相機拉遠而卸載。

### 公車操作

候車時顯示路線、方向及下一站；以互動鍵上車，前門為首版主要入口，後門可作主要下車門。具體門使用車型 metadata，不依 mesh 顏色猜測。

車內可選空座位或固定站立點；有簡單下一站顯示和下車鈴，按一次後保留請求並給回饋。首版可在所有所選服務站停靠以利驗收；若後續改為 request stop，需有候車／上下車請求與時序規則，不能使玩家錯過唯一可下車點。

下車時先預留合法路緣出口，驗證目標地板後才解除原乘客佔用；下車失敗保留車內原位置與佔用。車門開啟區被障礙佔用就等待、改用已驗證門或暫停，不把玩家放進車道、牆內、海面或另一層道路。上下車未結束不能關門發車；觸控介面也能上車、看向、按鈴和下車。

### SkyTrain 操作

玩家經站入口走到正確線別與方向月台，站牌與顯示屏提供本區可達站列表。到站後只開月台側的門，整列與停車位置對齊；跨月台的對面軌道不能當作下車地板。

SkyTrain 每站停靠，無需按公車鈴。玩家可在同一節的固定座位或站立錨點觀看城市／隧道，顯示下一站與本站；自由車內步行與貫通道在 moving collision 與連接幾何驗收後才開放。

Waterfront 轉乘需先下車、走過已建的通道與線別入口，再到另一組月台上車；不得以切換路線按鈕直接傳送到另一列車。Granville 與 Vancouver City Centre 如提供步行轉乘，是街面或已建商場連接，不稱為同一月台。

### 中斷與安全恢復

資產載入失敗保留候車狀態並顯示服務暫不可搭乘；登乘開始後失敗則回到原有效地板。正在乘坐的車資產或 context 中斷時保存服務與乘客資料，恢復後在最後有效站點或可恢復的車內位置重建，不自行重置到開場。

重新放置、切換至 drive/boat/fly、離開乘坐或退出服務，均須明確處理佔用與 player state；不能留下一個幽靈乘客。若目的模式不支援直接銜接，在有效車站完成下車或採有文字回饋的安全離開行為。

本期至少支援相同 session 內的身份持續與分頁返回；完整跨重新載入的 trip persistence 可另列後續工作，不假設目前手帳儲存已支持乘坐。

## SkyTrain 站體與交通資產

### 每站必要空間

不同車站共用樓梯、電梯、扶手、燈具外觀、票閘、標牌、月台邊與座椅模組，但各有獨立 layout 與來源。不得把同一高架盒子換站名當作所有地下或轉乘站。

每站至少具備可辨識的地面入口或站體、通往月台的垂直動線、必要大廳／票閘區、候車月台、合法進出路徑、正確線別與方向，以及列車門對位資料。第一批只建公共可達核心，不製作所有商場、設備房、員工區與完整樓層。

本期站內、車內與標牌使用既有照明及材質保持可讀、可搭乘，可交付必要燈具外觀；不新增夜景 light pool、營業亮燈時序或曝光調整。夜景 deferred 工作不能成為交通驗收依賴。

保留代表性無障礙路徑：可走的樓梯或坡面之外，有來源的電梯入口可用簡化電梯過渡到有效地板。若用載入過場，清楚記錄其為代表性連接；不能聲稱所有樓層已無縫步行。電扶梯首版可做靜態可走結構，不要求每階機械模擬。

站體尺寸與入口位置依官方站圖與 GIS；公開資料不足的深度、曲率及內部細節標 `representative`，交付來源圖與近似清單。TransLink 入口圖能支持入口與方向關係，不等同完整施工圖。來源：[官方站圖入口](https://www.translink.ca/schedules-and-maps/skytrain)。

### 地下與地形整合

地表、站內、月台與車廂使用不同 surface ID 和明確連接。地下動線不能只以地面 XZ 對位；需要連續高度、門口、樓梯／電梯交接及禁止區。

Expo 的 Dunsmuir 區段包含上下疊層 guideway，Stadium 附近才轉成並排軌道，不能把兩方向全程畫在同一高度。來源：[TransLink 對原隧道與 SkyTrain 改建的說明](https://buzzer.translink.ca/2025/12/skytrain-at-40-a-region-shaped-by-transportation/)。市府 [Rapid transit lines](https://opendata.vancouver.ca/explore/dataset/rapid-transit-lines/map/) 明記地下線形近似，只作平面參考；垂直 profile 要另製作並標精確度。

入口樣區必須處理地表與碰撞開口，避免樓梯入口被原地形或建築封住。可採局部入口 mesh、surface override 與受控區域遮蔽；不得用全域 clipping plane 切掉城市。站內相機不應看見地形穿過天花板；回到 Orbit 後城市地表保持完整。

隧道先提供必要車內視野、月台間過渡與連續軌道路徑，不要求每米做高細節結構。高架區段保留城市景觀；列車編組每節沿路徑取樣，以各 car transform 與連結點處理轉彎，不能讓整列長車像單根剛棒穿過彎道。

### 車型與站體交接

公車沿用 D02/D03 的 12 m 等級低地板代表性 profile；Expo 沿用 D04/D05 的 17 m 名義單節、四節代表性 profile；Canada Line 另建 profile 與編組，不繼承 Expo 的單節長度、門間距與月台對位。具體真車型資料核對後寫入 profile，使用代表性版本時不得標完整復刻。

車外、車內、門、座位、站立區與碰撞共用 vehicle root，明確記錄各 frame 與 datum。月台長度覆蓋整個實際編組及停車容差；登乘門檻與月台高度按實際匯出模型對齊，不套用舊展示模型的中心高度。

新站包交付 `station-layout.json`，至少包含 station ID、各 line/service stop ID、來源、地理錨點、local-to-world、level/floor/surface、入口與出口、walkable floors、stairs/elevator connectors、平台邊界、track exclusion、車門對位與停車位置、模組與材質引用、LOD 能力和 offline/runtime checks。

沿用既有資產流程交付 `.blend` 原始來源、GLB、簡化碰撞、manifest、重匯入預覽、尺寸與三角形報告。無 WebGL 的製作 agent 完成模型可標 `offline_complete`，整合狀態仍是 `runtime_pending_webgl`；只有實際站內與搭乘驗收才能標 `sample_accepted`。

### 常駐與按需載入

站外輪廓可在城市中常駐粗略表示；站內主要只常駐玩家所在站與接近的下一站。載客車保留當前可用內裝，其他服務車用共享外觀。路線資料和站點摘要可常駐，完整 interior 不隨所有站點一起載入。

首次進站或登乘前預取必要資產，有載入回饋並保留原有效位置。退出後使用有界 cache 和稍後回收，防止視距邊界反覆下載。同一站第二次進入應重用相同資源，不能每次新建一套貼圖和材質。

## 開發順序與交付物

| 階段 | 工作與依賴 | 完成條件 |
| --- | --- | --- |
| A 來源與契約 | 核對 HEAD、core、官方站點與路線；建立行人、service、vehicle、station IDs；保留既有資料接口 | 每個位置與 profile 有來源或近似標記，待用資產與 consumer 對應清楚 |
| B 活街與普通交通 | 行人資產、2 至 3 街區路徑、距離啟停、局部反應、有限的連續車流 | 相同樣區近看有人，拉遠仍保留城市；無穿牆、瞬移或全城 actor 常駐 |
| C 公車完整旅程 | 一條區域路線、至少 3 站、外內裝、站牌、停靠、身份交接、按鈴、安全下車 | 可從候車走到上車，搭到另一站，下車後繼續走；Orbit 往返身份不丟 |
| D Expo 兩站樣區 | 兩個真實站點的代表性站體、連續 path、車型、門與月台接口 | 同一玩家完成進站、乘坐、出站；高架轉彎與站台門側正確 |
| E 區域交通擴展 | Expo 5 站、Canada 3 站、Waterfront 轉乘；5／6 公車所選方向的範圍內完整停靠點 | 所有範圍內 SkyTrain 站點可用，區域端點不越界；兩條線具備獨立車型與路徑 |
| F 整合與文件 | 相關單元／狀態測試、實際瀏覽器畫面、觸控、資源回收與既有模式回歸 | 證據完整，列出限制，更新主開發文件；未測項不算通過 |

行人、車廂及站體模型可平行製作；程式整合依接口與來源順序進行。公車先驗收一個有限服務循環，再擴展 5／6 的全部所選方向；不得把未完成的端點交接留給玩家。SkyTrain 兩站樣區不能當作全區交通完成。

每個交付保存來源日期、baseRevision、重現命令、實際量測、offline 與 runtime 狀態、已知限制及下一個整合入口。展示模型可用、離線建模完成、可乘坐、跨站完成、全區擴展完成是不同狀態，不能混寫。

## 驗收與完成判定

### 必要旅程與畫面

| 編號 | 驗收場景 | 通過條件 |
| --- | --- | --- |
| V01 | Orbit 全城、Downtown 遠景、飛行俯瞰 | 城市、海岸與地標保持完整；近景人口不在全城生成；不得靠縮視距過關 |
| V02 | 步行靠近與離開活街，再以低空 Orbit 觀察 | 行人按距離出現與降級；無面前出生、反覆閃爍；32 人總上限仍有效 |
| V03 | 玩家靠近、喇叭、穿越點與候車事件 | 只通知附近角色；反應結束能回到有效路徑；站內和地面角色不串層 |
| V04 | 車輛通過至少兩個轉向或路口 | 路徑、朝向與高度連續；停止線、排隊與公車停靠不互相穿越 |
| V05 | 公車上車、乘坐、按鈴、下車，連續重複 10 次 | 身份、門、地板與佔用正確；下車可繼續步行；無重複 controller 或幽靈乘客 |
| V06 | SkyTrain 進站、候車、上車、跨站、下車、出站 | 僅開月台側門；不落入軌道；站外、地下與車內高度正確 |
| V07 | Waterfront Expo 與 Canada Line 轉乘 | 下車後通過實際已建動線到另一線；不錯用 SeaBus 通道或同月台假連接 |
| V08 | 搭乘時切 Orbit 並觀察遠處，再返回；搭乘時隱藏分頁 30 秒 | 同一車、同一乘客、有效站次與位置；無大 dt 跳躍或越界 |
| V09 | 區域最後一站留車與下車；資產失敗、服務不可用 | 正常停靠、合法回程或停妥等待；載客不淡出重生；失敗保留有效地板 |
| V10 | 原 Walk、Drive、Boat、Fly、手帳與公共室內 | 模式與相機切換正常；搭乘不錯發步行獎勵；既有碰撞與活動可用 |
| V11 | 連續服務 10 分鐘，經過多次完整循環；反覆切換表示 | 無端點重置跳車；表示交接姿態誤差以位置 ≤0.02 m、朝向 ≤1° 為目標 |
| V12 | 至少 20 次連點、取消、逾時、載入失敗與交接時切 mode | 交易回滾正確；無重複碰撞體、控制權或乘客，過期載入不覆蓋較新的狀態 |

桌面與 compatible／觸控路徑均需實際驗證上車、看向、下車及返回乘坐，不以桌面鍵盤通過代替觸控驗收。未取得 WebGL 的 agent 可以完成離線交付，瀏覽器項保持 not_run，由具備環境者接續。

### 資源與數字

本期不建立獨立 profiling 或通用 counter 工程。使用既有工具與同一裝置的有限整合檢查：記錄樣區開關新內容前後的畫質、實體解析度、角色數、幾何／貼圖用量及可取得的 frame time；記錄實際環境，不與上一輪台北快照換算速度倍率。

建議驗收門檻為新背景行人的共享 draw submissions 主 pass 不超過 8，背景人口額外三角形不超過約 32,000，最多 4 個近景骨架人物另計；全部新行人貼圖去重後 RGBA8 含 mip 估算以 8 MiB 內為起點。這是本期目標，若確需調整須給出實際原因與數據；陰影與其他 pass 分開記錄。

全城遠景關閉近景新內容後，不能仍然為所有行人、所有內裝或所有站內 geometry 常駐與更新。相同樣區往返 10 次後，geometry、texture 與 actor pool 應在既定 cap 內穩定，不隨次數持續增加。單次首次載入與 shader 預熱分別記錄，不把它們混成穩態 frame 成本。

共享資產以 refcount 或一致的 owner 規則回收，不能逐人 dispose 其他人仍使用的 geometry／材質；近骨架共享 clips 但不共用可變骨架 pose 或 mixer state。actor pool、station cache、車廂 cache 與 pending loads 都有明確上限。

frame time 提案門檻：同條件有效暖機樣區，加入新內容後 p95 增幅以 10% 內為目標；超過則先降低人口／骨架／陰影與載入成本，再調整視覺方案。這不是保證整城 60 FPS，也不能用更低解析度或更短遠景掩蓋回歸。若當時沒有可比量測，標未驗證，不能宣稱提速。

測試重點為狀態移交、門／平台條件、車廂 local transform、不同路面層級、端點與暫停恢復。資產的外觀、開口、尺寸與人尺度必須看實際匯出與瀏覽器畫面；JSON 測試不能代替觀察人站在車內是否穿頂。

## 夜間城市照明構想暫不實作

**狀態：deferred 暫不實作。** 本節沒有實作階段、沒有本期驗收、沒有要求製作夜間素材或調整正式場景。只有未來明確啟動夜景工作時，才把選中的構想轉成 planned。

Atlas 已有穩定 seed 控制的部分暖色發光窗戶、程序式路燈與發光燈頭，以及共享店面 atlas 的微發光。本節是增強這些基礎，不把它們當成完全缺少。來源：[建築窗戶](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/lib/city/building-bodies.ts#L348)、[路燈](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/lib/city/environment.ts#L406)、[店面材質](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/lib/city/shopfront-identity.ts#L304)。

夜晚的目標是看出真實城市的層次：活躍的商業街面、部分有人使用的住宅與辦公樓、路口與道路的照明，以及較暗的海面、公園與非營業街段。先讓光源分布與建築用途合理，再討論更多即時燈與效果。

### 真實資料與近似規則

市府 [Street lighting poles](https://opendata.vancouver.ca/explore/dataset/street-lighting-poles/) 提供位置、區域、block 與 node 識別，本次核對的 schema 不提供燈型、高度、色溫、朝向或即時開關。未來先裁切至 core，核對去重鍵，再替換或補足程序式路燈，不能兩套重疊或把全市點位全部畫進 Atlas。

市府 [街景設計指引](https://vancouver.ca/streets-transportation/streetscape-design-guidelines.aspx) 列有 Gastown、Chinatown 等不同燈具參考，可改善街區辨識；這是設計指引，不是每個點位的現場燈型紀錄。[Outdoor Lighting Strategy](https://vancouver.ca/streets-transportation/outdoor-lighting-strategy.aspx) 強調安全、降低眩光及光污染，適合作為有方向照地、保留暗部的原則。

商業／土地用途資料可輔助選擇適合亮起來的一樓街面，但缺少用途、燈型或營業時間時標為近似；不把營業執照的存在當成店家在某晚實際營業，也不使用私人住戶資料。Granville 等娛樂街與住宅街應有不同光感，不套用全城一致招牌密度；市府 [招牌分區說明](https://vancouver.ca/your-government/sign-bylaw-framework-and-regulations.aspx) 可作街區風格參考。

公開街景與官方設施圖可輔助抽樣核對，但並不提供實時每扇窗戶是否亮燈。住宅與辦公室亮窗比例、夜間使用時段與店面風格應作為有穩定 seed 的代表性提案，保留說明。

### 建議構想

| 構想 | 未來可能的低成本做法 | 需要保留的真實感 | 狀態 |
| --- | --- | --- | --- |
| 一樓店面有光 | 共享 storefront atlas、emissive 展示窗與簡化室內深度；先選 Robson、Gastown 或站口樣區 | 營業街段較亮，閉店有變化；並非所有門都變成霓虹店 | deferred 暫不實作 |
| 部分窗戶亮燈 | 同一 facade 內以樓層／窗格穩定 seed 控制 emissive mask；少量暖白與較中性變化 | 住宅、辦公室、公共建築的亮窗分布不同，整棟不要一致開燈 | deferred 暫不實作 |
| 路燈與光池 | 真實點位附近實例化燈頭發光面；路面用少量共享光池、vertex color 或其他局部近似 | 路口和人行道可辨識，公園與海面仍有暗部；光池遵循坡面和路面身份 | deferred 暫不實作 |
| 站口與公車站 | 標牌、候車亭與入口有適度自發光，近處補少量受控局部照明 | 方便找交通入口，不把整個街區照成白晝 | deferred 暫不實作 |
| 高樓夜間輪廓 | 遠景以稀疏亮窗與少量屋頂識別光表達 skyline，近景才提升窗面細節 | 保留 Vancouver 城市視角與海岸輪廓，不靠全局曝光把天空提亮 | deferred 暫不實作 |

emissive 材質讓燈頭、窗或招牌本身亮，不會自動照亮旁邊的人行道。未來若需要店門旁地面可見，須另加光照近似；不能只提高 emissive 就聲稱已經有真實照明。

未來優先讓大多數光源以共享材質與幾何表達，只有玩家附近 1 至 2 個重要位置考慮不帶陰影的局部動態燈，且另設全局上限。該數量是構想，尚未量測。不要每一扇窗、每一盞路燈都建立 PointLight 或開陰影；透明光池也須檢查疊加與 overdraw，不能當作免費效果。

日夜開關需要漸變、遲滯與緩存，尤其目前時鐘是 300 倍速；不要每幀隨機換亮窗造成閃爍。燈的色溫依採樣類型和資料決定，不能把全城統一染成橙色或藍色。保留已有白天材質與天空曝光，不以夜景構想重做白天明亮度。

## 資料來源與待核事項

本規格的事實來自固定版本的 Atlas、台北公開部署以及官方交通資料；文中人口、距離、面數、更新率和驗收門檻為工程提案。所有待開發能力與夜景構想均未實施。

- [Vancouver Living Atlas](https://github.com/YiTaChen/vancouver-living-atlas) 與 [現有待開發清單](https://github.com/YiTaChen/vancouver-living-atlas/blob/5574d55719f10d1575127d8b92cbd23ff71e446f/docs/AI_AGENT_DEVELOPMENT_BACKLOG.md)。
- [台北 GTA 公開部署](https://taipei-gta.vercel.app/) 與 [actors bundle](https://taipei-gta.vercel.app/assets/actors-Cceq-zXJ.js)，僅作設計原理參考。
- [TransLink SkyTrain 與站點入口圖](https://www.translink.ca/schedules-and-maps/skytrain)、[區域交通圖](https://www.translink.ca/schedules-and-maps/transit-system-maps)、[開發數據](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources)。
- [Vancouver 站點座標](https://opendata.vancouver.ca/explore/dataset/rapid-transit-stations/map/)、[線形](https://opendata.vancouver.ca/explore/dataset/rapid-transit-lines/map/)、[路燈點位](https://opendata.vancouver.ca/explore/dataset/street-lighting-poles/)、[街景設計指引](https://vancouver.ca/streets-transportation/streetscape-design-guidelines.aspx)。

實施階段需確定的細項：所採用的 GTFS 日期與具體 stop IDs、5／6 的服務方向和車輛風格、Canada Line profile 的實測或代表性尺寸、各站入口與內部深度、區域端點合法調度路徑、當前輸入綁定，以及固定座位／固定站立錨點到自由車內移動的開啟順序。這些屬於開發核對，不以缺少精確施工圖阻止完成有來源標記的代表性站體。

Source: Vancouver Living Atlas by YiTaChen。License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0。站圖、公共數據與參考項目的各自權利和來源保持獨立。
