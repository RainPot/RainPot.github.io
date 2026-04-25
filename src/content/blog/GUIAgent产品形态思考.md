---
title: "GUIAgent在测试领域的产品形态思考"
description: "GUIAgent在测试领域的产品形态思考"
date: "2025-01-11"
tags: []
draft: false
featured: false
readingTime: 10
---
# 一、概述
结合个别前端测试产品简单讨论GUIAgents在测试领域的角色。

# 二、前端测试产品
## 2.1 Rainforest QA

### 2.1.1 录制回放功能
[https://youtu.be/TVCRepJOPrg](https://youtu.be/TVCRepJOPrg "分享链接")  

视频中与playwright写自动化case进行了对比，整体上看通过圈选的方式定位交互的元素，提供了简洁且nocode风格的前端界面，使用无门槛，从描述上来看元素定位会保存三种信息：1.visual appearance, 2.an auto-identified DOM locator, 3.and an AI-generated element description.
以此来保证回放时的稳定性，让回放更加可靠。


### 2.1.2 nocode case generation
[https://youtu.be/Pbr8lUT8vZM](https://youtu.be/Pbr8lUT8vZM "分享链接")  

功能1: 写入自然语言Prompts，自动生成操作步骤 - https://help.rainforestqa.com/docs/how-to-generate-self-healing-tests  

功能2: 通过Agents在运行时做case的self-healing  

https://www.rainforestqa.com/no-code-test-automation
![](../../images/Pasted%20image%2020250103171909.png)
![](../../images/Pasted%20image%2020250103172644.png)

启发：
- 1.是否可以把写case也变成一种可交互的流程，对于用户来说只需要提供：1.初始页面 2.测试同学的测试目标（比如：测试酒店不同房型在酒店详情页和填单页的价格是否一致）。基于已有的测试需求或目标，自动补全或生成“每一步”的操作及测试目标，同时测试同学可以随时地调节其中的每一步骤，进行步骤增添或删除。
- 2. 自我修复机制。在Agent执行过程当中，自我去发现交互步骤中不合理的点，进行自我更新，但最终决策权归属于测试同学。
- 3. 在case失败的位置给予提示并表明原因 - https://help.rainforestqa.com/docs/ai-generated-description-of-failures
- ![](../../images/Pasted%20image%2020250106201201.png)

其本身在文档中也提到：
The more specific and descriptive the prompt, the more accurate the result.


### 2.1.3 AI Assertion
https://help.rainforestqa.com/docs/how-to-use-ai-assertions
类似于AUITestAgent的校验功能，提供一段校验点描述，AI进行断言。举例：
![](../../images/Pasted%20image%2020250106202033.png)

### 2.1.4 探索性测试
https://help.rainforestqa.com/docs/how-to-create-an-exploratory-run  

![](../../images/Pasted%20image%2020250106202506.png)
启发：  

- What to test: 这一点可以加入遍历测试当中，给予测试一定的目标，指导遍历测试进行探索性测试。
- 两种检测出来的问题：1.功能 bug 是应用程序未按预期响应的问题。2.可用性问题是测试人员感觉不直观的应用程序区域。



## 2.2 Applitools
https://applitools.com/  

做的事情与Rainfor依旧是 nocode-recorder + self-healing tests  

https://applitools.com/platform/create/
![](../../images/Pasted%20image%2020250107192055.png)
Automaticlly create tests for your full websites.

启发
- 更下一个阶段的目标，输入页面，自动生成各种各样的测试用例，每个用例测试同学可以自定义增删改测试目标与每一步交互。


## 2.3 MidScene
https://midscenejs.com/zh/
![](../../images/Pasted%20image%2020250107191530.png)

Web端，通过自然语言构建测试自动化用例，相较于Rainforest QA与Applitools使用成本更高一些。
核心能力：
- 用 `.ai`方法描述步骤并执行交互
- 用 `.aiQuery` 从 UI 中“理解”并提取数据，返回值是 JSON 格式，你可以尽情描述想要的数据结构
- 用 `.aiAssert` 来执行断言
```javascript
// 👀 输入关键字，执行搜索 // 尽管这是一个英文页面，你也可以用中文指令控制它 
await ai('在搜索框输入 "Headphones" ，敲回车'); 
// 👀 找到列表里耳机相关的信息 
const items = await aiQuery( '{itemTitle: string, price: Number}[], 找到列表里的商品标题和价格' ); console.log("headphones in stock", items);
```

启发：
- 针对AUITestAgent的校验能力，**抽取信息**这个步骤也可以抽离出来，作为action的一种，让测试同学自己指定。



# 三、思考
针对测试需求，大致可以分为四象限：
- 横坐标：固定路径 -> 非固定数据
- 纵坐标：通识知识 -> 专业业务领域知识

针对不同的测试需求，适合使用不同类型的自动化工具：针对固定路径与专业业务领域知识的，适合使用功能上贴切“录制回放”类型的工具。针对通识知识与非固定数据的，适合使用自然语言驱动的GUIAgents。当然，在GUIAgents足够强大时，所能负责覆盖的需求会逐渐扩展。

整体上是一个trade-off的问题，在当前阶段，录制回放更稳定但所需测试同学更细致地配置case，GUIAgents不稳定但case编写成本更低。  

期望在不远的将来，GUIAgents可以解决GUI Grounding + Plan 问题，叠加对测试需求的处理，能够更好地满足测试同学需求。

# 四、GUIAgents调研
贴一下近期的几个GUIAgents调研，下一篇博客介绍其中部分较新的GUIAgents。

+ [OS Agents: A Survey on MLLM-based Agents for General Computing Devices Use](https://github.com/OS-Agent-Survey/OS-Agent-Survey) (Dec. 2024)

  [![Star](https://img.shields.io/github/stars/OS-Agent-Survey/OS-Agent-Survey.svg?style=social&label=Star)](https://github.com/OS-Agent-Survey/OS-Agent-Survey)
  [![arXiv](https://img.shields.io/badge/arXiv-b31b1b.svg)](https://github.com/OS-Agent-Survey/OS-Agent-Survey/blob/main/paper.pdf)
  [![Website](https://img.shields.io/badge/Website-9cf)](https://os-agent-survey.github.io/)

+ [GUI Agents with Foundation Models: A Comprehensive Survey](https://arxiv.org/abs/2411.04890) (Nov. 2024)

  [![arXiv](https://img.shields.io/badge/arXiv-b31b1b.svg)](https://arxiv.org/abs/2411.04890)

+ [Large Language Model-Brained GUI Agents: A Survey](https://arxiv.org/abs/2411.18279) (Nov. 2024)

  [![Website](https://img.shields.io/badge/Website-9cf)](https://vyokky.github.io/LLM-Brained-GUI-Agents-Survey/)
  [![arXiv](https://img.shields.io/badge/arXiv-b31b1b.svg)](https://arxiv.org/abs/2411.18279)

+ [GUI Agents: A Survey](https://arxiv.org/abs/2412.13501) (Dec. 2024)

  [![arXiv](https://img.shields.io/badge/arXiv-b31b1b.svg)](https://arxiv.org/abs/2412.13501)




