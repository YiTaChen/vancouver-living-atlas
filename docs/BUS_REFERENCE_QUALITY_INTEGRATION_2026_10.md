# 公車近距離品質版本整合（2026-10-09）

本次把 PR #10 的 `closeup-quality` 接入停放公車參觀：弧面 navy 座椅、連續銀色扶桿、黑色內窗框／藍色外窗框、頂板接縫與嵌入式細斑地板貼圖均來自真正的 GLB。近景車流繼續使用已整合的 B-CAB 預算內裝；新模型只供最多一台停放公車參觀使用。

本文件補充 [Stage 2 整合紀錄](STAGE2_TRANSIT_INTEGRATION_2026_10.md)。[來源 README](../tools/assets/boardable-bus-v2/closeup-quality/README.zh-TW.md) 與來源 `qa/` 是 PR #10 的離線交付紀錄，其中「尚未整合」及 GPU 未驗收的描述保留當時狀態。本次 consumer、部署政策與最後 GPU 結果以本文件為準。

## 使用範圍與品質選擇

公車面板增加 Auto／輕量／細節選擇。Auto 使用城市當下的有效品質：既有自動控制器的決策或手動品質值；參觀選項不改寫城市的 Auto／手動設定。

| 參觀選擇／有效城市品質 | 停放公車內裝 |
| --- | --- |
| 相容模式，任何選擇 | 原 B-CAB 預算 LOD0 |
| 輕量 | 原 B-CAB 預算 LOD0 |
| Auto，平衡 | 新近距離品質 LOD1 |
| Auto，高或 Ultra | 新近距離品質 LOD0 |
| 細節 | 新近距離品質 LOD0 |

所有停放參觀沿用原外殼 LOD0 與真實車門動畫。選擇在準備參觀時解析；ready 狀態更換選項會釋放舊 owner 並重新準備，上車後凍結目前模型，選單停用至下車。`BusCabinVisit.prepare()` 的直接呼叫也會刷新已準備但尚未上車的不同 profile，不必依賴 UI 先關閉舊參觀。

選用的近距離來源載入失敗時，保留可用的預算內裝參觀，並在 snapshot／面板揭露 `profile`、`requestedProfile` 與 `fallback`。失敗的請求會移出 cache，下一次準備可重試；使用者取消或城市 dispose 不觸發預算 fallback。

車流政策保留原外殼 LOD1＋預算內裝 LOD1：正常最多 4 台，相容模式 2 台，80 m 進入、110 m 退出。Auto 快速旅行仍透過既有 `allowNew` 暫停新增近景細節；冷遠景不請求公車 manifest／GLB。品質參觀的 metadata 固定 `runtimeScope: 'nearby-bus-visit-only'`、`fleetAllowed: false`。

## 固定來源與精確 payload

來源為 Vancouver Living Atlas by YiTaChen，授權沿用 Vancouver Living Atlas Noncommercial Research and Attribution 1.0。這是依舊預覽圖重新建立的可編輯幾何，不代表找回原始舊 3D 檔；駕駛區與隱藏尺寸仍依已核對的新版布局完成。

近距離來源固定至 revision `78790023c4cf6e5f12aaf2666ea74dd47336dbd8`，路徑 `tools/assets/boardable-bus-v2/closeup-quality/`，manifest SHA-256 為 `2d3a1abbbc35ddc161a154c0a262b42493fe2601c368dde05cd6b3a81b699726`。重用的原外殼 manifest SHA-256 為 `32a35e7fdaa0f82600f8d161212b952177fae8515ca8095b2d55be118503076e`；未重建或替換外殼與門動畫。

以下是 `public/models/blender/bus-closeup/` 的精確三檔。GLB 直接複製來源 export，manifest 為 canonical runtime projection；三角形、頂點與 primitive 取自交付 GLB。

| 檔案 | Bytes | 三角形 | 頂點 | Primitives |
| --- | ---: | ---: | ---: | ---: |
| `city-bus-12m-interior-v2-closeup.lod0.glb` | 8,508,968 | 277,040 | 246,564 | 13 |
| `city-bus-12m-interior-v2-closeup.lod1.glb` | 2,955,124 | 91,504 | 95,110 | 13 |
| `manifest.json` | 778,733 | — | — | — |

兩個 GLB 合計 **11,464,092 bytes**，三檔合計 **12,242,825 bytes**，不含既有外殼或預算內裝。精確 SHA-256：

- LOD0：`8174cf56646eec303ad1891222cbd056d8ddea1e593c9a1e7ce70bc77a524a6d`
- LOD1：`7ab9103a047a7acd48f78433e3b982a475592e2f6a747e1c7533685b4053de45`
- Runtime manifest：`5783e85c796f9b2627109d71f4f4d5ef242991bb8ecd0fc0ef44f44d27278293`

[Projection](../tools/project-bus-closeup-runtime.mjs) 檢查 12 個實際來源依賴：近距離 manifest、兩檔 GLB／`.blend`／component sidecar、地板 PNG，以及原外殼 manifest 與三檔 GLB。可編輯來源、sidecar、獨立 PNG 和 QA 預覽均不產生公開 runtime URL。

新參觀的獨立上限為 LOD0 ≤ 300,000 三角形／9,000,000 bytes，LOD1 ≤ 100,000 三角形／3,100,000 bytes。原 B-CAB 上限仍為 12,000／3,000 三角形及 1,572,864／393,216 bytes，原採用內裝仍是 11,704／2,824 三角形及 736,884／202,492 bytes。新模型明確超出原 B-CAB，沒有提高原預算上限。Primitive 數是幾何分組數，實際 draw calls 另由 GPU 記錄。

## 布局、材質與支撐契約

兩檔均為 +Y 向上、+Z 車頭、−X 車輛右側的米制座標，包含 82 個非 mesh 節點（81 個語意節點加 `vehicle`）。24 個有效座位的 pelvis／camera、driver、standing、boarding、doorway 錨點與朝向均核對來源；三個收起位置保持不可坐。低地板站位使用 `low-floor-aisle`，眼高沿用來源 `camera-aisle` 的 1.99 m。既有預設選項解析器在 v2 不會把舊 `main-aisle` 傳給上車操作。

低地板 Y=0.36 m，台階 Y=0.52／0.68 m，後平台 Y=0.68 m、代表性淨高約 1.92 m，後區保持 seated-only。六塊 floor support 含兩片與門齊平的支撐板，補足原詳細 master 的 10 cm 縫。來源 validator 的 3,306 支撐射線及 runtime `BusCabinSurfaces` 使用實際向上三角面檢查站位、台階和門檻；新的曲面幾何使用重新量測的保守碰撞 metadata。

參觀沿用 passenger adapter、座位預覽與佔用／保留機制；預覽只移動相機。被阻擋的下車維持原座位與相機狀態。固定錨點、簡化輪椅保留區和離線採樣沒有增加自由步行、移動車流上下車或無障礙認證。

13 個來源材質保留完整 PBR 色彩、roughness、metalness、透明度與 double-sided 設定；只有玻璃使用 alpha 0.22 BLEND。navy 坐墊為線性 `[.010,.033,.073,1]`、roughness 0.78；銀色管材為 `[.46,.52,.55,1]`、metalness 0.78、roughness 0.23。銀色管材與原 v2 的同名 surface 有不同 PBR，因此新內裝使用獨立 reference 材質 pool，避免覆寫車流材質。缺少 `COLOR_0` 時只補中性白色頂點乘數。

每檔 GLB 內嵌同一張 **256×256 RGB、98,020 bytes** 的地板 PNG，SHA-256 `9d5c9bbe86766050cc56e345218b47ddca5e7f8b3aebcd45d9967f86f49b2bb2`。它是唯一貼圖，僅作 `bus-v2-floor` 的 baseColor，使用 sRGB、RepeatWrapping、channel 0、`flipY: false` 與線性／mipmap filter；六倍平鋪已烘焙在 floor UV。地板 baseColor 乘數為中性白、roughness 0.92，解碼後平均線性 RGB 約 `[.16996,.18996,.21009]`，維持來源 `[.17,.19,.21]` 的基色。GLB 無外部 buffer／image、skin、內裝動畫或 QA 相機／燈光。

## 有界 cache 與回收

最多一個 parked owner；模板最多六個：外殼 LOD0／1、預算內裝 LOD0／1、近距離內裝 LOD0／1。原 pool 上限 15 個材質，新 reference pool 上限 13，兩者全載入時合計最多 28 個共用材質；兩檔近距離來源最多保留兩個地板 Texture 物件。這些是資源上限，不代表全部每幀提交或 GPU 記憶體 bytes。

關閉參觀停止／uncache mixer、移除 owner，保留有界模板供重用。近距離 GLB fetch 接收 AbortSignal；不能中斷的 `parseAsync` 若晚到，會按 signal／generation 丟棄並回收成功解析的幾何、材質、貼圖與 ImageBitmap。失敗請求移出 cache；城市 dispose 釋放全部模板、共用材質與唯一來源資源並關閉 ImageBitmap。取消後不會把舊 owner 掛回場景，也不保留可無限增長的參觀實例。

Parked group provenance 記錄實際採用的 `packageId`、來源 pins、profile、requestedProfile 與 fallback；使用近距離來源時不會仍宣稱採用預算包。SkyTrain 展示的品質、城市暫停與資源生命週期沿用前次整合，未修改其來源 PBR 或模型。

## 原始來源與 Blender 版本

獨立檢查核對 closeup hash inventory 全部 50 個宣告檔及 default Node test 的來源雜湊；16 張 1152×768 PNG 預覽與其實際 GLB 輸入雜湊相符。預覽由交付 GLB 重新匯入 Cycles CPU 產生，不能代替正式 WebGL 成本測量。

先前 Stage 2 release inventory 的 303 個檔案中，**302 個 bytes／SHA-256／Git blob SHA 完全相符**；唯一預期變動是 `boardable-bus-v2/README.zh-TW.md` 加入近距離品質版本入口（7,877 → 8,271 bytes）。原詳細 master、B-CAB derivative、原 GLB／`.blend`、舊 QA 與其他 Stage 2 來源保持原 bytes；沒有更新封存 inventory 來掩蓋 README 的差異。

來源的 byte-identical roundtrip QA 使用 **Blender 4.3.2**。本次以本機 **4.5.12 LTS** 直接重開兩個現存 `.blend`，使用來源 `export.py --output /tmp/...` 匯出副本；沒有執行 builder／`refine.py`、覆寫來源或重生封存 QA。

兩檔都可重開並匯出。4.5.12 每檔比交付版本少 **10 個頂點、240 bytes**：LOD0 為 246,554 vertices／8,508,728 bytes，LOD1 為 95,100 vertices／2,954,884 bytes。三角形、13 個 primitive、bounds、PBR、嵌入 PNG 與語意錨點保持一致，重新匯出的六地板／3,306 射線契約通過；GLB 與 sidecar 並非 byte-identical。正式 payload 沿用上述 4.3.2 交付雜湊。後續編輯須先固定 Blender 版本，再更新量測、provenance、projection 和驗收證據。

七個 SkyTrain 站、四個離線互動人物與 renderer candidate 繼續保留來源，未部署或掛入城市；既有 Mark V／Canada Line 單車廂展示不變。完整列車服務、車站地形接通、旅程／轉乘、moving-service boarding、跨車廂步行和平台互鎖仍待後續整合。

## 獨立驗證與部署閘門

- Source validator `--check-only` 通過；Python 品質／負例 **41／41**，default Node 品質／adapter **8／8** 通過。
- 凍結 consumer／guard 的獨立 scoped tests **48／48** 通過，0 fail／skip／cancelled；包含實際兩檔 GLB／地板貼圖、六模板上限、PBR、ready 切換／上車凍結、fallback／retry、晚到回收、舊預算 caps、座位／門／支撐，以及 production provenance／leak 負例。
- [Stage 2 guard](../tools/verify-stage2-transit-adoption.mjs) 對 `public` 的獨立檢查通過：原 10 檔加新 3 檔，共 **13 檔**，GLB bytes **14,473,216**，保護 **223 個不同來源雜湊**。Adopted inventory 由原 35 檔增加至 38，原 35 檔的 payload 保留。

`verify-firebase-build.mjs` 繼續無條件執行 Stage 2 guard，也保留原公車 adoption guard。部署檢查從 pinned 來源重建 canonical metadata，檢查實際 geometry／anchors／floor／嵌入貼圖與精確三檔 inventory；不能只改公開 manifest 或重算 inventory 以啟用 fleet、變更色彩空間或移除安全 metadata。詳細 master、站點、未掛載人物、預覽、`.blend`、sidecar、獨立 PNG、額外 metadata、symlink 及改名後相同來源 bytes 仍不得漏入 production。

可重複執行且不重生來源報告的檢查：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/assets/boardable-bus-v2/closeup-quality/validate.py --check-only
PYTHONDONTWRITEBYTECODE=1 python3 tools/assets/boardable-bus-v2/closeup-quality/test_quality.py
PYTHONDONTWRITEBYTECODE=1 node --test tests/bus-closeup-quality.test.mjs
node --test tests/bus-closeup-runtime.test.mjs tests/bus-closeup-adoption.test.mjs tests/stage2-transit-adoption.test.mjs tests/bus-v2-runtime.test.mjs tests/bus-visit-selection.test.mjs tests/bus-visit.test.mjs tests/bus-engine-integration.test.mjs
```

## 最終 GPU／全量驗證

主代理在凍結的實作上執行 `npm test`：**1,017／1,017 通過**，0 fail／skip／cancelled；`npm run check`、本次新增／修改的 bus、UI、projection、guard 和 regression scoped lint、既有 architecture GLB audit `--skip-blender` 均通過。`engine.ts` 的兩項 unused import 與一項既有 `any` lint 診斷仍是原有基線，未宣告全 repo lint 通過。

實際 GPU 使用 **ANGLE Metal／AMD Radeon Pro 560X、Chrome 154**，1280×720、pixel ratio 1。驗收透過公開按鈕與選單操作，通過輕量→自動精緻 LOD1→完整 LOD0 的上車前切換、24 席與預設站位、後排視角、乘客錨點不被 preview 移動、上下車／門／關閉、14:00／23:00，以及上車後選單鎖定。額外驗證 High＋Auto 選 LOD0；上車後將城市畫質改 Balanced 仍保留 LOD0，下一次參觀才選 LOD1。375×812 與 375×400 可切換畫質、上下車；短螢幕的面板在 y=106、高282、可捲動364px內容。瀏覽器 error／warn 為空。

實際遠景 checkpoint 沒有載入公車模板、reference 材質／貼圖或 parked owner。三個品質來回切換並關閉後，parked owner 回到0，模板最多6、reference 貼圖最多2；這些模板保留以供下次重用，直到引擎 dispose，沒有宣告每次關閉清空 cache。初始／暖機／關閉 checkpoint 的 GPU geometry 數會包含城市其他內容，不能據此斷言全城記憶體固定不增。

[驗收摘要](qa/bus-reference-20261009/acceptance.json) 和同目錄的原始 GPU checkpoint、逐幀記錄、capabilities 及三張真實 renderer PNG 可重查。QA 的 parent revision 為 `7879002`（驗證尚未提交的整合變更），實際視覺來源 fingerprint 為 `3957231f6e59b82037c40556d63b18cc9805c87d8f30e2d74a9e06c03dfd118e`；所有圖與 JSON 都來自此凍結版本。手機布局是互動驗收，未另保存手機 PNG。

以下為相同站位／相機、Manual Balanced、1280×720 的觀察。完整逐幀序列長度不同，城市行人／交通／列車持續運動，未控制隨機場景，因此**不是硬體效能保證或改善百分比**。

| 模型／視窗 | FPS（總幀數／時間） | p95 frame ms | p99 frame ms | 最大 frame ms |
| --- | ---: | ---: | ---: | ---: |
| 輕量／14.48秒全段 | 38.12 | 41.64 | 49.60 | 53.70 |
| 精緻 LOD1／27.62秒全段 | 32.95 | 58.70 | 102.49 | 145.30 |
| 輕量／最後8秒 | 35.37 | 43.57 | 50.71 | 53.70 |
| 精緻 LOD1／最後8秒 | 35.95 | 48.09 | 85.73 | 139.20 |

LOD1 包含初次 shader 暖機，但後段仍有139.2ms延遲，不能將所有卡頓都歸因於第一次載入。LOD0 的採樣改為面向車尾，非上述相同相機比較；全段32.64 FPS、p95 41.95ms、p99 193.24ms、最大209.3ms，也不宣告零卡頓。弱裝置可強制「輕量」，兼容模式始終使用輕量；Auto 選擇只在準備參觀時發生，不讓已上車模型反覆切換。既有城市 Auto controller 仍可調整場景畫質／解析度，但這次未以公車訪視資料宣告飛行／駕車效能改善。

實際 GPU 的光照／tone mapping 與來源 Cycles／AgX CPU 預覽不同；本次保留作者的 PBR 與嵌入貼圖，沒有以材質重新上色去偽造預覽。夜間城市新增店家照明仍在原先延期範圍，本次沒有擴充。

正式 `npm run build:firebase` 已通過：13 檔 Stage 2 guard、38 檔 adopted inventory、來源／metadata／實際 bytes 與 QA 標記隔離均通過。驗收後重新計算625個視覺來源檔案的 fingerprint，與上述 GPU 紀錄完全一致。GitHub exact-head CI 與 main 部署結果由交付 commit／PR 及 Actions run 對照確認。
