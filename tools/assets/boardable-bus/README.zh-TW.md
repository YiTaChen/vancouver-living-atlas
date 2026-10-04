# 12 m 代表性低地板公車：可編輯離線交付

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)

本包完成 D02 外觀、D03 車廂的離線建模與接口；D06、WebGL、正式載入及部署仍為 `runtime_pending_webgl`。現有 `lib/city/city-buses.ts`、`public/` 與舊資產不變。實際完成狀態與數值以 `manifest.json`、`qa/handoff.json` 及驗證紀錄為準。

## 模型與尺度

- 原創、無照片／下載模型／品牌標誌的 12 m 等級研究車型。它是專案代表性提案，不是 New Flyer 的完整實測，也不是無障礙法規認證。
- 車體約寬 2.50 m、長 12.00 m。含後通風／燈、鏡子及屋頂設備的 LOD0 bounds 約為 3.04 × 3.07 × 12.034 m。**完整寬不等於車廂淨寬。**
- glTF：+Y 向上、+Z 前進、−X 右側門。Blender：(x,y,z) 一次轉為 glTF (x,z,−y)。所有外殼、內裝、collision JSON、門與座位共用 vehicle root。
- 原點位於輪胎接地面 Y=0、車身中心 X=0、前後輪軸中點 Z=0；軸心 Z=±3.10、Y=.49，輪胎半徑 .49 m。
- 真實地板頂面 Y=.36；頂棚下緣 Y=2.60，站立淨高 2.24 m。取樣主走道寬 .90 m，超過 .75 m 研究目標。模型為連續低地板方案，沒有未申報台階；wheel-well 是明確障礙。
- 10 個乘客座位，座寬 .46、深 .44、座面 Y=.81（離地板 .45 m）。每席給 pelvis、facing、camera eye 及相同名稱 Empty。pelvis 不是角色脚底/root。
- 右側輪椅／嬰兒車空位約 .72 × 1.55 m，沒有座椅或扶手柱佔用；這是代表性留空區。
- 前門 Z=3.70..4.85、後門 Z=−1.20..−.05，門洞寬 1.15、高 2.10、sill Y=.36；前後各兩片門均有獨立 GLB action。先外移 .14 m，再縱向滑移 .62 m，避免把門掃進殼體。
- 外觀有真中空薄殼、曲折圓角車頭、傾斜前窗、獨立窗面、真輪拱、鏡子、屋頂設備、車燈與四獨立輪組；內裝另有 floor、wheel-well、壁／頂板、駕駛隔板／座席、乘客座席、扶手、停車鈴及小屏幕。

## 檔案與成本

- exterior：三個獨立壓縮 `.blend`／普通 GLB；LOD0/1 可保留洞口與開門，LOD2 為明確封閉的空車展示 fallback。
- interior：兩個獨立壓縮 `.blend`／普通 GLB，供近景或載客 lazy-load。source 保留 72／62 個可編輯 mesh 物件；匯出時按 semantic material role 批次為每 LOD **7 primitives**，保留原本 3,760／888 triangles。
- runtime textures：0；semantic material roles 綁 shared surface ID，沒有每車或每座位私有 maps。玻璃有 alpha、雙面語意，opaque roles 保持 backface culling。
- `qa/measurements.json` 列實際 triangles／vertices／primitives／bytes／bounds。primitives 不是 GPU 實測 draw calls；開門、關門外觀 primitive 數相同，外觀與內裝合用另列。
- LOD2 以不透明深色側窗／後窗帶提示輪廓，208 triangles；這些是封閉視覺提示，不是可用洞口。LOD2 完整 bounds、datum、門／輪錨點及不可登乘能力不变。
- editable mesh、UV、材質節點、LOD0 圓角 modifier、門 action 保留在 source。壓縮來源各小於 20 MiB；不是把 GLB 匯回後冒充製作來源。

### 靜態內裝 batching 與錨點契約

`export.py` 先從 artist source 正常匯出，再以 `batch_static.py` 只處理該 GLB。source 不 merge、不覆寫。七個 `interior-batch-<role>` meshes 用於 rendering；原本 floor、座椅零件、扶手及其他 component node 名稱留作 **zero-draw Empty 錨點**。Consumer 不應再把 floor／seat component 節點當成有 mesh 的物件。

每個 batch node 的 `extras.componentRanges` 和 manifest 的 `lod.staticBatching` 記錄 sourceNodeId、parent 累積 transform、vertexStart/count、indexStart/count、triangles 及 bounds。Validator 直接讀交付 BIN 中的 ranges 還原 component geometry，檢查無重複、缺口或越界，再跑原有地板／門洞／座位／collision rays；沒有用 metadata bbox 代替幾何。來源副本的單一 cushion 提升 .012 m，經保存、重開、batch export 後仍可量出同一改動；所有 source hashes 不變。源 GLB 與 batch GLB 的頂點最大差約 2.1e−7 m，UV／normals 和三角形數量保持。

## 從 repository 根目錄執行

保留人工編輯的正式匯出入口：

```sh
blender -b -t 2 --python tools/assets/boardable-bus/export.py -- --output /tmp/boardable-bus-reexport
```

從原始程序建立**另一套新來源**（不覆寫既有 artist source）：

```sh
blender -b -t 2 --python tools/assets/boardable-bus/build.py -- --output /tmp/boardable-bus-generated
blender -b -t 2 --python tools/assets/boardable-bus/export.py -- --source /tmp/boardable-bus-generated/source --output /tmp/boardable-bus-generated/exports
```

在原包內經明確修改來源、重匯出後重建成本／metadata 並驗證：

```sh
blender -b -t 2 --python tools/assets/boardable-bus/export.py -- --output tools/assets/boardable-bus/exports
python tools/assets/boardable-bus/metadata.py
python tools/assets/boardable-bus/validate.py
python tools/assets/boardable-bus/test_contract.py
blender -b -t 2 --python tools/assets/boardable-bus/qa_blender.py
python tools/assets/boardable-bus/finalize.py
```

Blender 每次單一 process、2 threads。預覽 640×400、24 samples、Cycles CPU。此 Blender build 沒有 OpenImageDenoise，明確停用 denoiser；不把嘗試失敗的初次渲染當作通過。可用 `--sources-only` 只跑 source-preserving／重匯入測試，`--previews-only` 只更新實際 GLB 預覽。不要同時啟動多個 Blender。

## 幾何驗證與影像

`validate.py` 使用實際 GLB triangles / node transforms，交叉核對來源 hash、預算、座位／pelvis／相機／輪軸／anchor、floor +Y winding、地板射線、主走道與車廂空腔、輪椅區、完整門洞射線、動畫 endpoints、逐門 21 取樣姿勢的 swept bounds／triangle edge intersection，以及所有 boarding-capable LOD。不存在相機或 lights 的 runtime payload；QA 參考人形只在渲染場景。

`qa_blender.py` 逐一開啟五個來源、保持來源重新匯出至臨時目錄，再實際重匯入五個交付 GLB。另把來源副本的屋頂 mesh 提升 .017 m，修改 paint 值及自訂屬性，保存／重開後只用 export.py 匯出，檢查三種人工編輯仍存在，原 source hashes 不變。

`qa/previews/` 是交付 GLB 的 CPU 渲染：正／右側／後／俯視、晴／陰／暮／夜四研究光照、同相機三 LOD、門開關、兩入口、走道、每個乘客席及駕駛視點、縱向剖面。外部影像含 1 m 尺及 1.75／1.81 m 人形；剖切只作用於 QA reimport，未更動 runtime meshes。contact sheets 方便核查，個別原圖保留。

## 接手順序與限制

1. 驗證 manifest/hash、共同原點、角色材質與 source edits；優先完整 LOD0 + interior0。
2. 用真實來源道路／站點的 service transform 與合法 walk surface 配置。門檻 Y=.36 需要站點高度或坡板方案，離線 bus 不會自動補出 curb connection。
3. 移除舊地形 ground+1.08 高度補償；`legacyToVehicleRoot` 只描述 datum 換算，不表示新幾何是舊頂點逐點映射。
4. 使用 JSON collision primitives，對門片碰撞同步套 action transform。不要對中空車廂採用整車實心 AABB。walkable floor 消費時扣除 obstacle refs。
5. 有人、開門或 boarding 時鎖定 exterior0/1 + interior0/1；LOD2 禁止登乘、禁止載客、門關閉。座位 metadata 不等於 rider system 已實現。
6. 繼續 D01 停靠對位及 D06 service/passenger state machine，elapsed time 獨立於 300 倍日夜時鐘。WebGL 透明排序、LOD、input、moving collision、重複上下車／dispose、GPU成本均未測。

本包的離線數值是建模與遊戲契約，不代表完整路線營運、駕駛力學、煞車安全、公共運輸認證或全城 FPS。外觀粗 LOD 的閉合狀態有意不同；外部完整 bounds 與主要輪軸／門錨點仍保持。
