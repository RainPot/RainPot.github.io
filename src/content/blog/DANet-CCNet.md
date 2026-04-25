---
title: "DANet-CCNet"
description: "LeetCode"
date: "2019-01-21"
tags: ["Semantic Segmentation"]
draft: false
featured: false
readingTime: 6
---
两篇文章都是将self-attention机制应用到分割当中，扩大感受野。第二篇文章采用了更巧妙的方法来减少参数。
<!--more-->

## DANet
[Dual Attention Network for Scene Segmentation](https://arxiv.org/abs/1809.02983)

self-attention在分割中应用的大致思想是：特征图与特征图的转置进行矩阵相乘，由于特征图有channel维度，相当于是每个像素与另外每个元素都进行点乘操作，而向量的点乘几何意义为计算两个向量的**相似度**，两个向量越相似，它们点乘越大。看下图，特征图转置与特征图矩阵相乘后用softmax进行归一化就得到了Attention map S。S再与特征图的转置进行矩阵相乘，这个操作把相关性信息重新分布到原始特征图上，最后再将这个信息与特征图A相加，得到最终输出，这个输出结合了整张图的相关性结果。

![attention](https://i.loli.net/2019/02/25/5c73485641635.png)

整个网络的框架如下图：非常简单，***特征提取->attention module->上采样得到分割图***

![structure](https://c2.staticflickr.com/8/7896/40180410623_4f9679fd0e_c.jpg)

除了上面说的那一部分attention，作者还加了蓝色channel attention，在这里计算特征图与特征图转置矩阵相乘操作时，相乘的顺序调换了一下，这相当于是让channel与channel之间进行点乘操作，计算channel之间的相似性，在这里我认为每张channel map代表了不同类别，这样让类别与类别计算距离，来进行辅助。作者并没有解释为什么这么做，估计这也是论文不中的原因之一。

实验结果在cityscapes，PASCAL Context，COCO Stuff上都达到了SOTA。

## CCNet


[CCNet: Criss-Cross Attention for Semantic Segmentation](https://arxiv.org/abs/1811.11721)

本篇文章的亮点在于用了巧妙的方法减少了参数量。在上面的DANet中，attention map计算的是所有像素与所有像素之间的相似性，空间复杂度为(HxW)x(HxW)，而本文采用了criss-cross思想，只计算每个像素与其同行同列即十字上的像素的相似性，通过进行循环(两次相同操作)，间接计算到每个像素与每个像素的相似性，将空间复杂度降为(HxW)x(H+W-1)，以图为例为下：

![Criss-Cross](https://c2.staticflickr.com/8/7855/33269146498_d88d65fa1c.jpg)

整个网络的架构与DANet相同，只不过attention模块有所不同，如下图：在计算矩阵相乘时每个像素只抽取特征图中对应十字位置的像素进行点乘，计算相似度。

![attention](https://c2.staticflickr.com/8/7834/46421141234_df4a92107c_o.png)

经过一轮此attention计算得到的attention map如下图R1所示，对于每个元素只有十字上的相似性，而通过两轮此计算，对于每个元素就会得到整张图的相似性，如R2。

![result](https://i.loli.net/2019/02/25/5c734f3259325.png)

得到此结果的原因如下图，经过一轮计算，每个像素可以得到在其十字上的相似性，对于不同列不同行(不在其十字上)的像素是没有相似性的，但是这个不同行不同列像素同样也进行了相似性计算，计算了在其十字上的相似性，那么两个十字必有相交，在第二次attention计算的时候，通过交点，相当于是间接计算了这两个不同列不同行像素之间的相似性。

实验结果达到了SOTA水平，但没有计算全部像素的attention方法准确率高。