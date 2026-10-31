# 本地人脸模型对比 · 2026-10-29

后续已完成[扩大样本实验](FACE-MODEL-EXPANSION-2026-10-29.md)：共 1,000 张照片、200 组配对，199 组有效，179 组用于冻结阈值验证。扩大后的选型结论以该报告为准，下文保留首轮 40 组的历史成绩。

本轮已完成用户人工评审，并按用户确认更正第 20 组：40 组配对，21 组同一人、19 组不同人，无不确定项。测试使用用户授权的素材库样本，全程本地处理；没有修改应用、生产数据库、原片或人物分组，也没有上传素材。

## 结论

**更正标注后，原先三套模型“误合并”的结论已撤回。** MobileFaceNet、ArcFace R50、AdaFace 的配对 AUC 均为 1.0000，SFace 为 0.9875。在保持原照片划分和校准阈值不变的验证中，SFace 漏判 1 组同人，另外三套无判错；四套均无误合并。40 组仍不足以支持全库精度或低误合并率的保证。

建议优先将 **Raccoon S 的核心检测与识别模型作为下一步轻量候选，SFace 保留为对照基线**。Raccoon S 核心权重约 30.6 MB，本机 CoreML 热运行检测约 5.3 ms/张、特征提取约 1.7 ms/脸；它在本轮更正后的样本上与两套大模型均完全分开，且判对了 SFace 漏判的这一组。没有启用其可选 face verifier。Buffalo L、AdaFace 相对这个轻量方案暂没有展示额外精度收益。

人物管理的下一步应先提供可撤销的分组建议、人工命名与合并确认，再用更难的样本验证阈值；本次结果不足以支持直接对全库自动合并人物。此次只完成选型实验，尚未接入产品。

## 样本与比较方法

- 180 张照片，来自 64 个文件夹；按文件夹分层取样，包含人物提示样本与普通场景。人物提示不作为身份真值。
- 139 张从普通原片解码，26 张使用 RAW 内嵌 JPEG/预览，15 张回退到库内缓存。较清晰预览最长边为 1600 px；缓存通常约 320 px。
- 读取了 171 个在线原文件，复核大小和修改时间未变；其余 9 个离线原文件只使用已有缓存。
- 选取 74 个对齐裁切供四个识别器共用，识别器分别使用其正确的输入预处理。裁切主要来自 SCRFD 1280 检测，因此识别成绩不等于完整 YuNet/SFace 或其他端到端组合的成绩。74 个裁切不代表 74 位不同人物。
- 人工配对由同文件夹邻近素材与随机配对生成，不用模型身份预测选题。用户在不显示模型分数的页面上完成 40 组标注。
- CPU 测试使用 2 个线程；Mac 加速另取 24 个样本进行热运行计时。模型初始化、CoreML 首次编译、磁盘解码、全库聚类和前端耗时不包含在热运行数字中。
- 环境：arm64 Mac，Python 3.12.9、OpenCV 4.11.0、ONNX Runtime 1.31.0。没有改动生产应用依赖；额外实验依赖位于隔离目录。

## 人工配对结果

AUC 衡量同人与不同人配对的分数排序区分度，**不是实际使用正确率**。1.0000 只说明这批已标注样本在该指标上完全分开。

| 识别器 | 40 组配对 AUC | 验证集误合并 | 验证集漏判同人 |
| --- | ---: | ---: | ---: |
| SFace | 0.9875 | 0 | 1 |
| ArcFace MobileFaceNet（Raccoon S 核心） | 1.0000 | 0 | 0 |
| ArcFace R50（Buffalo L） | 1.0000 | 0 | 0 |
| AdaFace IR50 | 1.0000 | 0 | 0 |

阈值验证方法：按配对涉及的原照片组成连通分量，划分 20 组校准、20 组验证，同一原照片不跨集合。校准集有 7 组同人、13 组不同人；更正后的验证集有 14 组同人、6 组不同人。仅在校准集上选阈值，最大化平衡准确率；并列时优先减少误合并，再取较高阈值。第 20 组在验证集中，更正时冻结原划分，因此校准集与阈值完全未变。

| 识别器 | 本轮校准阈值（余弦相似度） |
| --- | ---: |
| SFace | 0.248531 |
| ArcFace MobileFaceNet | 0.184492 |
| ArcFace R50 | 0.223549 |
| AdaFace IR50 | 0.244685 |

这些阈值只用于本轮实验，不能直接作为上线配置。AUC 完美的模型仍可能因校准阈值偏低，在验证集误合并。

逐项复核时，原先三套的“误合并”都发生在**同一组验证配对**。用户查看后确认是误按标注，实际应为同一人，已保存更正。该组的 SFace／MobileFaceNet／R50／AdaFace 分数分别为 0.154066／0.206955／0.386883／0.331971。只有 SFace 低于本轮自身阈值，因此更正后三套判对、SFace 漏判。原始裁切和照片预览只在私有本地评审页「更正案例」展示，不附入本报告。更正前结果仅留在隔离目录的历史记录，不再作为当前结论。

该划分是在本轮标注后设计的探索性复核，尚未做人物互斥、预先固定的独立测试。配对之间可能共用人物，验证集只有 6 组不同人；无法估计全库低误合并率。样本内 bootstrap 对完美排序模型产生退化区间，不将其解释为总体准确率保证。

## 本机速度与体积

| 核心检测＋识别方案 | 权重大小（十进制 MB） | CPU 检测 ms/张 | CPU 特征 ms/脸 | Mac 加速检测 ms/张 | Mac 加速特征 ms/脸 |
| --- | ---: | ---: | ---: | ---: | ---: |
| YuNet 640＋SFace | 38.9 | 6.487 | 9.169 | 未测 | 未测 |
| Raccoon S 核心 | 30.6 | 152.699 | 6.471 | 5.315，CoreML | 1.746，CoreML |
| Buffalo L 核心 | 191.3 | 154.402 | 77.824 | 5.909，CoreML | 4.245，CoreML |
| Buffalo SCRFD＋AdaFace IR50 | 191.5 | 154.402 | 27.009 | 5.909，CoreML | 7.800，MPS |

以上均为各阶段中位耗时。CPU 检测使用 180 张照片、特征使用 74 个裁切；加速分别使用 24 张照片和 24 个裁切，不能把各阶段中位数相加当成已测端到端速度，也不能把未加速的 SFace 与加速方案作完全公平的推理性能排名。Raccoon S 的 CPU 特征提取在本轮也比 SFace 更快。

CoreML profiling 确认实际执行了 CoreML 节点。识别加速输出与同输入 CPU 输出最小余弦相似度约为 0.99999988；两套加速检测在 24 张照片上候选框数量均与 CPU 一致，最大框坐标差小于 0.0002 px。节点事件数不代表计算覆盖率。

初始化另计：Buffalo 检测约 2.41 秒、识别约 2.34 秒；Raccoon 检测约 0.24 秒、识别约 0.88 秒。这些是本次会话记录，不保证每次冷启动都相同。

## 检测与输入分辨率

| 检测设置 | 缓存候选框／有候选照片 | 较清晰预览候选框／有候选照片 |
| --- | ---: | ---: |
| YuNet 640 | 56／40 | 72／50 |
| Buffalo SCRFD 640 | 89／57 | 97／59 |
| Raccoon SCRFD 640 | 89／57 | 92／58 |
| Buffalo SCRFD 1280 | 89／58 | 102／68 |

YuNet 阈值为 0.8，SCRFD 为 0.5，模型置信度未统一校准。**没有人工框真值，以上不能称为召回率或正确检出数。** 1280 补检的 CPU 中位耗时约 610 ms/张；没有测其 CoreML 速度。

四种同源裁切扰动另测了降采样、模糊、压暗与 JPEG 压缩，只反映同一裁切的特征稳定性；不同模型的原始余弦分数不可直接当成识别精度排名。

## 模型版本、来源与授权边界

- YuNet：`face_detection_yunet_2023mar.onnx`，配合 OpenCV 4.11；SFace：`face_recognition_sface_2021dec.onnx`。参考 [OpenCV YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) 与 [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface)。本地保留对应 MIT、Apache 2.0 许可文件。
- Buffalo L：`det_10g.onnx`＋`w600k_r50.onnx`；Raccoon S：`det_10g_wo.onnx`＋`w600k_mbf.onnx`。来自 [InsightFace 官方模型发布](https://github.com/deepinsight/insightface/releases/tag/model-zoo)。Raccoon S 的可选 `face_verifier_mnv2.onnx` 没有启用，30.6 MB 只计算核心两项。
- AdaFace：作者发布的 [CVLFace AdaFace IR50 / WebFace4M](https://huggingface.co/minchul/cvlface_adaface_ir50_webface4m)，使用 RGB 输入约定，严格匹配 467 个权重键。Google Drive 配额不足后，使用镜像传输原作者 safetensors，按官方 LFS SHA256 核验，未使用替代第三方训练权重。
- [InsightFace 预训练模型说明](https://github.com/deepinsight/insightface/blob/master/python-package/docs/model_zoo.md) 将公开预训练权重限定为非商业研究；Raccoon S 包内授权亦注明 non-commercial。CVLFace 预训练权重的使用还涉及训练数据许可，代码许可不能替代权重授权。本次为本地研究，没有把这些权重打入产品。

发布者校验值：

| 文件 | SHA256 |
| --- | --- |
| YuNet ONNX | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| SFace ONNX | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |
| Buffalo L 原始 ZIP | `80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f` |
| Raccoon S 原始 ZIP | `f67a624ef8a4495899eb4359a8a6953f7b4c62a8399c5bc745c0e0f6582f898d` |
| AdaFace safetensors | `da82e6e1dbe98ce23afb78283b858ad65e32484a2bac82e9adae298d04ff845d` |

## 保存位置与未验证范围

隔离实验目录：`/Users/zack/program/python/video_analyzer/build/face-benchmark-2026-10-29`。其中包含私有照片副本、裁切、特征向量和人工标注，不应提交或上传。用户标注、模型、复现脚本与结果保留；下载压缩包与失败下载已清理。

主要复现入口：`prepare_samples.py`、`benchmark.py`、`accelerators.py`、`detector_accelerators.py`、`analyze.py`。本地页面服务为 `review_server.py`，仅绑定 loopback；汇总为 `results/final-analysis.json`，冻结划分为 `results/evaluation-split.json`，更正记录为 `results/label-corrections.json`。更正后人工标注文件 SHA256：`f5ccbd27c08795f34a5c150f354df4a761752de9ad11765758e0cdfc38d779a4`。

已检查对齐变换、权重加载、有限且归一化的特征输出；评审计算与标注保存的 3 项合成测试通过。加速结果已对照 CPU。本轮报告只含汇总，不附人物照片、裁切编号、特征向量或素材路径。

未验证：人工检测框真值、人物互斥的大规模测试、侧脸/遮挡/儿童成长等困难样本的独立分层结果、视频跟踪、全库人物聚类、自动命名、产品集成、长期误合并率与 SFace 的 Mac 加速。
