# 公車近距離品質重建：舊預覽中的座椅、窗框與車廂層次

這是依使用者提供的舊預覽圖重新建模的可編輯品質版本。**不是找回遺失的舊 3D 檔案，也不是只改燈光的展示圖。** 座椅、扶桿、窗框、頂板和相關配件都是本目錄 GLB 的實際幾何。

本目錄是新的近距離品質選項。原詳細 master 和 B-CAB 簡化版完整保留。主分支已採用原 `runtime-candidate`；**本品質版本尚未取代遊戲內模型，未完成 runtime/WebGL/GPU 效能驗收。** 本次交付不修改正式 consumer、public 模型或部署。

## 先看實際 GLB

- [品質 master 全車前望後](qa/previews/cabin-quality-lod0.png)
- [品質 master 座椅近照](qa/previews/seat-quality-lod0.png)
- [品質 master 頂部與圓管近照](qa/previews/roof-rail-quality-lod0.png)
- [品質 master 前區與駕駛區](qa/previews/front-quality-lod0.png)
- [品質 master 後望前](qa/previews/rear-quality-lod0.png)
- [較低成本品質版全車](qa/previews/cabin-quality-lod1.png)
- [較低成本品質版座椅](qa/previews/seat-quality-lod1.png)
- [較低成本品質版頂部](qa/previews/roof-rail-quality-lod1.png)

同相機、同日光與同曝光的原檔比較：

- 舊詳細版：[全車](qa/previews/cabin-baseline-master.png)／[椅子](qa/previews/seat-baseline-master.png)／[頂部](qa/previews/roof-rail-baseline-master.png)
- 現有預算版：[全車](qa/previews/cabin-budget-candidate.png)／[椅子](qa/previews/seat-budget-candidate.png)／[頂部](qa/previews/roof-rail-budget-candidate.png)

上述是從各自真正的 GLB 重新匯入的 Cycles CPU 圖。光源、相機位置、鏡頭、AgX、曝光 0 保持一致；原檔比較為 48 samples，新品質預覽提高至 96 samples，沒有降噪或影像後製。每張圖的實際輸入 SHA、取樣數與鏡頭記錄在 [預覽索引](qa/previews/index.json)。不能用 master 圖片代表原預算版的細節。

## 依圖重新做的項目

1. **椅子直接對照舊圖的設計**：沒有鈕扣的 navy 弧面靠背、圓角及前緣下彎坐墊、淺灰外殼包邊、連續銀色側框／上方握把和細支腳。靠背及坐墊由多層曲面建立，不是對原方塊加一層平滑法線。
2. **黑色內框、藍色外框**：兩層皆為實際連續框件；另有窗封、窗台、金屬內凹接面與柱。黑內框至藍外框有約 34 mm 深度差。所有新增窗飾都避開兩門完整開口邊界。
3. **圓管與接點**：master 主要管件 32 邊，較低成本品質版 16 邊，側面連續平滑法線；彎頭採連續圓弧掃掠而非獨立直管互插。依圖使用銀色管材、局部黃色握套／停止拉繩、淺色套環、基座、吊環及天花板支架。
4. **車廂頂部**：橫向拼板縫、縱向暗槽、燈條反射邊、較小的通風葉片、淺灰維修蓋與扣件。避免原先粗黑 U 形邊框。
5. **整體材質與完成度**：補齊下側灰色壁板／黑色踢腳；真正嵌入 256×256 灰色細斑地板貼圖。貼圖正確編碼為 sRGB，解碼後維持原地板線性基色約 `[.17,.19,.21]`，不是用曝光拉亮。navy 坐墊保持 `[.010,.033,.073,1]`、roughness `.78`。

舊圖只提供可見形狀與風格，無法回復原始厚度、背面或精準尺寸。駕駛區在該圖中沒有近距離證據，所以保留已核對過的新版前區關係並完成一致的細節，不宣稱那裡是精準複製。

## 三種檔案的成本與用途

| 檔案 | triangles | GLB bytes | 材質 primitive | 用途／限制 |
| --- | ---: | ---: | ---: | --- |
| 本品質 LOD0 | 277,040 | 8,508,968 | 13 | 可編輯詳細 master／近照品質基準 |
| 本品質 LOD1 | 91,504 | 2,955,124 | 13 | 相同設計的選擇性重採樣比較版；效能未驗收 |
| 原預算 LOD0 | 11,704 | 736,884 | 11 | 現有已整合較簡化版本，未由本次更動 |
| 原預算 LOD1 | 2,824 | 202,492 | 11 | 現有遠一些的簡化版本，未由本次更動 |

新兩級皆超過原 B-CAB 的 12,000／3,000 triangles 與 1.5 MiB／384 KiB 目標。沒有提高或移除原預算驗證。新品質版的 13 個 primitive 加上既有外裝 21 個 primitive 是 34 次幾何提交估算，**不是 GPU draw call/FPS 實測**。

較低成本品質版保留窗框、頂部、座椅、袖套與連續彎管，減少彎角取樣、曲面內部環與細倒角段數；沒有對所有圓管盲目 decimate。 最靠近握把的視角仍可看出較低成本版彎角輪廓的些微分段；它保留同一設計，但不是與 master 逐像素或逐頂點相同。未使用貼圖的材質不輸出多餘 UV，以減少頂點分裂和傳輸量。兩個 GLB 都含一份地板 PNG；GLB bytes 已包含它。來源 `.blend`、貼圖和離線 component sidecar 另外計量，完整資料見 [measurements.json](qa/measurements.json)。sidecar 不是 runtime 必須下載的資源。

## 布局、門檻與契約

- 沿用 +Y 向上、+Z 車頭、−X 車輛右側；前左司機／設備櫃、前右無座輪拱、3 個側向優先座、對面 3 個收起位置、4 個低地板前向座與17個後區座位。
- 24 個可坐座位及全部 pelvis、camera、driver、doorway、boarding、standing 錨點／朝向不变。
- 低地板 0.36 m、後平台 0.68 m、後平台仍僅供坐姿。新幾何保留兩片齊平門檻支撐，補足原詳細 master 的 10 cm 支撐縫；以真正三角面與跨縫射線驗證。
- 新增曲面與框件有重新量測的保守碰撞盒。沒有沿用舊部件的過期碰撞 metadata。
- 「後區不變」只指座位關係、層高、錨點與通道契約；本品質版後區椅子及扶桿曲面確實重建，不能套用原前區修正的逐頂點相同證明。
- 空間測試是離線取樣與保守包圍體檢查，不是連續角色 capsule sweep、上下車動畫或無障礙認證。

## 編輯、再匯出與驗證

`.blend` 保留獨立可編輯座椅部件、管件、窗框和屋頂零件；不要先執行 `refine.py` 才匯出。一般美術修改後直接重新開啟來源再匯出：

```sh
blender -b -t 2 --python-exit-code 1 --python tools/assets/boardable-bus-v2/closeup-quality/export.py -- --output /tmp/bus-closeup-reexport
python3 tools/assets/boardable-bus-v2/closeup-quality/validate.py --check-only
python3 tools/assets/boardable-bus-v2/closeup-quality/test_quality.py
node --test tests/bus-closeup-quality.test.mjs
blender -b -t 2 --python-exit-code 1 --python tools/assets/boardable-bus-v2/closeup-quality/qa_sources.py
```

`refine.py` 是保留的圖像設計重建方法，預設拒絕覆蓋已有 `.blend`。日常再匯出只評估現有來源、清理數值退化的微小面、保留法線和真正的 floor UV，再做材質 batching。來源本身不被匯出器改写。

- [實際 GLB／門框全邊界／座位／站立／輪椅區驗證](qa/validation.json)
- [來源再開／完全一致再匯出／編輯副本保存探針](qa/blender-validation.json)
- [負向回歸測試](qa/regression-tests.txt)
- [既有 passenger adapter 實測](qa/adapter-tests.txt)
- [完整視覺核對](qa/visual-review.json)

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0
