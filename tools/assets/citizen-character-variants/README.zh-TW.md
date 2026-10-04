# F04 市民、警員與駕駛：獨立離線來源包

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0

本包修改既有授權 repository 內的原創人物，沒有引入外部模型、照片、動捕或官方警徽。基準為 `aef5e31d4eb8d5d3f832d0931373bf6583227033`。正式 `public/`、`lib/city/citizen.ts`、导航、警員 selector、Roadster 與舊 `citizen/optimization/` 均未修改。Citizen／police與搭配精確可選cockpit的自然driver離線完成；通用`driver`收腿研究保留為**inspection-only，integrationEligible=false**，不得當可選駕駛。最新真實狀態見 `manifest.json`、`qa/validation.json`、`qa/handoff.json`；WebGL 一律 `runtime_pending_webgl`。

## 交付與來源身份

- 四個家庭 citizen／police／driver（收腿研究）／driver-roadster-fit（自然伸腿、配可選cockpit），各有三個壓縮 `.blend`、三個普通 glTF 2.0 GLB，共十二個來源與十二個輸出。
- `.blend` 是由**目前採用的 1024px GLB** 重建的可編輯網格、UV、22骨架、權重、baked actions、材質節點與 packed maps。不是找回原始 sculpt、voxel remesh 或材質烘焙歷史；原產生器仍是 `tools/assets/citizen/build_citizen.py`。警帽／帽簷／兩面抽象盾形 badge 是本包新增可編輯幾何。
- Runtime GLB 使用三張**內容 hash 去重**的外部 1024² PNG。`exports/textures/` 不能漏傳；GLB 本體不能當作無依賴單檔。沒有 Draco／Meshopt／KTX2 runtime 擴充或新 decoder；meshoptimizer 只在離線製作減面索引時使用。
- 尺度維持 1 unit = 1m。Blender +Z up／−Y forward，glTF +Y up／+Z forward。基準人物約1.81m；警帽增加約5.3cm，不能把帽子計入人体身高再縮小整人。
- 最終GLB：Citizen 37,735／31,767／29,931 tris；Police 38,483／32,515／30,679 tris；收腿研究Driver同Citizen；自然Driver 36,417／30,449／28,613 tris。每個LOD0均低於40,000 tris。所有 GLB、外部圖像、sources、primitives 成本分列，不把CPU估計當GPU實測。

## 先修 LOD，再減面

舊減面會焊接 GLB seam vertices，對完整 coat／denim 減面，再解析式重算 pelvis 權重。它曾通過骨架數值測試，但後腰存在布料／UV／shading 差異。本包不修改舊庫存，而从採用的 LOD0 重新派生：

1. 用虛擬位置連通性辨識兩個 garment component，**不焊接實際 UV／normal seam**。
2. 顏、手、鞋、領口、背包、附件及整個 Y=.78–1.08m 腰／下擺區域保留；所有接觸 protected vertices 的三角形完整保留，邊界再鎖一圈。
3. 在其餘 garment triangles 使用 attribute-aware、index-only collapse，既有頂點 position／UV／normal／22通道 skin weights 不做改寫。法線、UV、權重納入誤差目標。
4. 近中／中遠候選誤差上限為1mm／2mm。LOD2 在29,995個來源三角形已達誤差上限，最終匯出為29,931 tris，**不為追上舊27,531數字而破壞腰或臉**。
5. Blender重存custom split normals有很小量化差異；逐頂點最大L1差約0.00046，基準與各LOD相同。沒有把這稱作逐位元法線相同。

採用基準本身有64個**面積恰為0**的三角形。可編輯來源保留它們；所有runtime匯出只省略這64 triangles／192 index entries，不動position、UV、normal、skin或bind arrays，符合共通validator。不能把清掉無面積三角形當作畫面或FPS改善。

`qa/simplification.json` 記減面停止點及 protected triangle 0 改動；`qa/lod-surface-audit.json` 用實際 GLB 做最近三角面 centroid／UV／normal 比較，含舊候選與新候選。UV最近面可能落到相鄰重疊布料，最大值只作診斷。真正後腰證據是固定鏡頭三個跑步 phase、獨立 close-up 及 protected UV／weight 回歸；不能以單一數字宣稱無損。

## 警員：只能改制服

`police-uniform-clothing-only` 只綁原coat／denim兩個連續網格 component。保留原normal／roughness maps，以獨立navy baseColor替代這兩個衣物表面；原 `citizen-atlas-protected` 的 baseColor map 和 factor 完整保留，臉、手、頭髮、鞋、領口、背包不染色。綠色領口／袖口及背包是刻意保護既有部件，並非聲稱官方制服重建。新增帽、皮質帽簷、原創抽象盾形徽章分語意role。沒有武器。

一個Blender skinned mesh按五材質匯出成五個glTF primitives／Three SkinnedMeshes；不是一個draw。材質、貼圖可共享，pose skeleton 必須每實例獨立。膚色與護理材質不得在consumer端被全NPC tint覆蓋。

## 駕駛：研究件與可選整合候選分清楚

兩個driver家庭都使用原22骨架與同一1.81m人體，不縮放車或人、不伸長四肢；保留idle=2s、walk=1s、run=.8s、walk stride1m、run stride1.9m。導航仍擁有位移與distance phase。額外 `driver-seated` 是1秒靜止loop；GLB rest stance仍為standing，consumer必須啟動正確clip。

### `driver`：只供檢查的收腿研究

這個保留背包的舊車研究pose只做到不相交，膝部過高，已拒絕作為可用駕駛。manifest寫入 `integrationEligible:false`、`integrationMode:inspection-only`、`runtimeSelectable:false`，沒有runtime consumer。`qa/driver-fit-iterations.json`是历史九个原车姿勢診斷，不是最後自然候選驗收。更自然的伸腿會碰原實心dashboard與低方向盤，不能用繼續收腿或縮小人物掩蓋。

### `driver-roadster-fit`：只配精確可選cockpit

自然候選保留原hip／腿長與姿勢，軀幹後傾8°；**僅此driver家庭**移除9個daypack／harness component，Citizen／Police／研究件的背包均不變。手腕從方向盤後方接近9／3點位置；手指使用保留原長度的前15mm直線、28mm半徑弧形corrective，包住19mm管徑半徑的rim。

`DriverGrip`在獨立的skinned hand mesh上，rest／idle／walk／run權重0，僅`driver-seated`權重1。保留22 bones，新增的是可編輯shape key與keyframes，不是額外手指骨。Blender來源的`driver-grip` action由source-preserving exporter併入同一`driver-seated` clip。CPU與renderer都在skin之前套morph；離開駕駛時必須停止或fade掉`driver-seated`，不能全域強制權重1。原gait恢復0有正／反與crossfade檢查。此家庭2個primitives，共用同一skin atlas；不能仍宣稱單draw。

依賴 `tools/assets/roadster-driver-fit/` 的實際GLB／specs hashes，不互相hash可变manifest：
- 原車root不變，character translation `[.44,0,-.06]`、quaternion identity、scale `[1,1,1]`
- 原尺寸方向盤center改為 `[.44,1.06,.40]`，其半徑、tube與傾角不變
- 原driver座椅整組剛性前移 `.265m Z`；乘客座椅與外殼不變
- driver局部dashboard下方淨空／foot support extension由可選cockpit包提供；原車與正式consumer未改

實際morph→skin→world三角形對實際solid驗證，三LOD的非手部碰撞皆0。手部有限採樣最大穿入約 **2.746／2.284／2.295mm**，兩手都接觸，通過未放寬的3mm gate。這是靜態近似接觸，不是連續penetration全域極值、ergonomic認證或方向盤轉動驗收。座墊最近gap約4.95mm；背部表面距離仍是剛性布料的支持近似，不是soft-cushion模擬。

面部eye-band平均約 `[.4398,1.4721,-.0590]`，現行navigation eye為 `[.45,1.2,0]`。必須明確做camera migration；camera-local cockpit是另一consumer，不可把這個值偷塞進正式相機。沒有踏板、seatbelt、上／下車與轉向動畫或WebGL驗收。

`qa/driver-natural-reference.json`只比較自然pose與**原始**dashboard，會保留預期的不相容；真正可選cockpit驗收是 `roadster-driver-fit/qa/driver-fit-lod*.json` 和本包manifest的精確dependency。`driver-roadster-*`照片是已拒絕的原車研究，不能拿來代表自然候選；自然配車的最新照片由 `roadster-driver-fit/qa/previews/` 提供。

原九來源reexport證據與新增三來源分開保存；總檔必須覆蓋十二個來源，source-before／after不變且輸出hash等於canonical GLB。所有來源明確從採用GLB重建，不冒稱原雕塑／烘焙歷史。

## 可重現命令（repo root）

首次明確重建 defaults（會取代本包來源；不是保留美術修改的工作流）：

```sh
node tools/assets/citizen-character-variants/simplify.mjs
blender -b -t 2 --python-exit-code 1 --python tools/assets/citizen-character-variants/build.py
```

**美術編輯後使用此路徑，不跑build.py**；輸出到新的空目錄，原source不得改寫：

```sh
blender -b -t 2 --python-exit-code 1 --python tools/assets/citizen-character-variants/export.py -- --out /tmp/citizen-review-export
# 亦可 --source tools/assets/citizen-character-variants/source/police.lod0.blend
```

Exporter只選runtime mesh／rig，清除暫時顯示pose後匯出actions；不重建defaults、不焊接、不減面、不烘焙覆蓋藝術修改。它對極小roundtrip float drift恢復exact原inverse binds；若改了rest rig超出容差，**拒絕匯出**，不默默覆蓋retarget。來源bone契約變更須獨立版本。

驗證、離線照片及實際artist-style修改證明：

```sh
node tools/assets/citizen-character-variants/validate_cpu.mjs
node tools/assets/citizen-character-variants/check_driver_fit.mjs
blender -b -t 2 --python-exit-code 1 --python tools/assets/citizen-character-variants/audit_blender.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/citizen-character-variants/prove_editability.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/citizen-character-variants/render.py
python tools/assets/citizen-character-variants/finalize.py
python tools/assets/citizen-character-variants/validate.py
```

姿勢研究可重現且不覆蓋正式來源：

```sh
blender -b -t 2 --python-exit-code 1 --python tools/assets/citizen-character-variants/probe_driver_fit.py -- --out /tmp/citizen-driver-studies
```

每次只跑一個Blender process、兩threads。32samples、Cycles CPU、小幅PNG；此Blender build無OpenImageDenoise，未使用不存在的denoiser。正／後／側、三LOD四種研究光照、三個跑步phase、後腰特寫與真實Roadster組裝照片均由GLB重匯入。QA人形1.75m／1.81m和1m尺不進runtime GLB。

`qa/artist-edit-proof.json` 記錄真正打開來源、移動胸徽8mm及改uniform節點、保存重開、source-preserving匯出、再重匯入實測的結果與hash；不是重新生成預設後比對自身。

## 後續 consumer 的具體合約

1. 保持 navigator 的穩定root、contact shadow、navigation-owned位置與距離採樣。任何LOD／角色載入失敗保留舊模型；generation ticket阻止late promise把已dispose／已換LOD角色掛回場景。
2. 先用QA-only selector映射穩定family+LOD+hash。正式預設繼續目前citizen；警員與driver是明確角色選擇，不能自動把所有NPC換高面數。
3. 建立content-hash geometry/material/image cache與reference count；十二個GLB共享三張map。每個actor使用SkeletonUtils clone獨立bones／mixer，不能共用活動骨架。快取清空只釋放最後consumer；ImageBitmap只close一次。
4. LOD建議試點8／20m、2m hysteresis、約150ms screen-door fade；只是未驗證提案，不能寫成已量測最佳門檻。玩家／近景driver固定LOD0。fade的color/depth/shadow使用相同coverage，最多兩LOD短暫resident；不把alpha blending造成的排序問題隱藏。
5. 切換保留idleTime、walkedDistance、walk/run權重與clip phase。動畫以真elapsed time／distance運行，不跟300倍日夜鐘。遠距凍結、crowd pooling另有budget，不由本包擅自啟用。
6. 自然driver必須驗證`requiredCockpit`完整payload hashes、按clip擁有morph，在退出時停止／fade seated；拒絕任何`integrationEligible:false`研究件。
7. 在High1080p及目標低端裝置量測loading/first pose、四光照、後腰run phase .70/.775858/.85、LOD來回／fade、skin tone、手腳接觸、driver camera、failed load、late disposal和texture residency。報告actual calls/triangles/frame times，不從CPU tris宣稱FPS改善。
