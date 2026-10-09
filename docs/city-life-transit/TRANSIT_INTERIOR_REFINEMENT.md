# 公車前段修正與 Mark V 內裝

2026-10-09；此輪修訂起點為 `a965982a58b5d15996af68899de021fa30f9267c`。仍為 PR #9 的離線資產候選，沒有掛入正式場景。

## 修訂依據

### 公車

使用者提供的是較早的生成預覽，僅用來比對版本，不能當成真車照片。實際程式檢查沒有證明「把後半段鏡像」的操作；已確認的問題是把前半段配置成三組朝前雙人座，重複了後段座椅與扶手的排列節奏。

重新查閱並逐張檢視 West Vancouver XD40 同代照片後，前段改為側向優先座、收起的側座／留空區、輪拱護欄、駕駛側設備櫃與獨立駕駛／收費區；朝前雙人排座保留在較後方。原有外殼、車門與車身座標未換成另一款車。

- [XD40 #1202 駕駛區](https://www.flickr.com/photos/chsscassidy/8184218228/)
- [XD40 #1210 前往後視角](https://www.flickr.com/photos/thetransitcamera/36077892202/)
- [XD40 #1210 後往前視角](https://www.flickr.com/photos/thetransitcamera/35439742583/)

坐墊改為較深、低飽和的海軍藍，並提高 roughness；是 GLB 材質本身的修改，不只降低預覽曝光。後段保存證據對比的是詳細可編輯來源的實際幾何；降低面數的 derivative 另列，不能宣稱其頂點與 master 完全相同。

### SkyTrain

改以官方已投入 Expo Line 服務的新款 **Alstom Mark V** 為視覺依據。真車為五節 A–C–C–C–B、全列 84.8 m；此包先製作 A／端車內裝候選，單節尺寸與間距仍是代表性建模值，沒有假稱取得施工圖。

- [TransLink：Mark V 於 2025-07-10 投入服務及官方照片](https://buzzer.translink.ca/2025/07/translinks-mark-v-skytrain-enters-service/)
- [官方座位配置圖](https://buzzer.translink.ca/wp-content/uploads/2024/05/Mark-V-Seating-Layout-scaled.jpg)

依端車配置建立 22 個座位、交錯配置的彈性區、前端觀景區與後端貫通段。新增曲面椅墊、灰色椅殼與鏤空把手、黃色彎管及固定件、門窗內緣、頂棚細節與原創材質圖。攝影作品、列車內的第三方藝術／廣告均不直接複製為貼圖。

這是獨立 Mark V 候選，**不替換或冒充 Canada Line**，也不套用既有四節 Expo 17 m 模板。五節編組、實際門／站台匹配與完整路線仍待另一階段驗證。

## 驗證與交付狀態

- Mark V LOD0：10,992 triangles、1,177,176 bytes；LOD1：2,964 triangles、305,404 bytes。兩者各 10 material primitives，保留 22 座與精確 pelvis／camera 錨點。詳細 study 另存，超預算，不可當作 runtime 模型。
- 公車詳細 master：30,200／14,984 triangles，2,634,280／1,449,360 bytes。此版本超 B-CAB 預算，保留可編輯細節；LOD0 309 個與 LOD1 217 個後段 component 的 world vertices、triangle indices、material assignments 均與修訂前逐一相同，坐墊材質色值則刻意更新。
- 公車 budget derivative：LOD0 11,704 triangles／736,884 bytes；LOD1 2,824 triangles／202,492 bytes。詳細量測見本包 runtime-candidate/qa/measurements.json。保留 24 個啟用座位及原有 driver／door／pelvis／camera 契約，後段保持 17 座；減面模型不聲稱逐頂點等同詳細 master。
- 支撐檢查發現原有公車內地板在 X=-1.15 結束，而外部門框在 X=-1.25，兩門均有 10 cm 缺口。詳細 master 保留並揭露此繼承限制；derivative 增加兩個 flush threshold slabs，僅延伸門口支撐至外框，不更動門或錨點。
- Mark V 23 項 regression tests；詳細公車 23 項 Python 與 6 項實際 adapter tests；derivative 39 項 Python 與 6 項 adapter tests 通過；另外獨立 143,220 個 portal／join／aisle 實際三角形支撐樣本均無缺口或高度漂移。
- 重新執行 npm test（836／836，0 skipped）、typecheck、Firebase build、scoped lint 與 production 隔離負例。完整 lint 仍有 211 個既有錯誤，83 個出錯檔案與 PR #6 完全相同。
- 全部來源均有重開、edit-copy 及 byte-identical re-export 證據。預覽由最終 GLB 重匯入產生，索引保存精確 GLB 與 PNG 雜湊。

機器可讀總結與完整命令輸出見 tools/stage2/qa/。Hosted CI 因 draft 依賴 PR #6 分支而未執行；不能把沒有 workflow runs 當成 CI 通過。

實際 WebGL、乘客進出、運行中跨車廂、動態車門互鎖、平台與地形匹配、GPU 效能：尚未執行。CPU 預覽是實際 GLB 重匯入渲染，保留取樣雜訊，不以生成圖片替代模型證據。
