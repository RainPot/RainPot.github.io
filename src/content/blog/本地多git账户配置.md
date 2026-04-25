---
title: "本地多Git账户配置"
description: "本地多Git账户配置"
date: "2023-01-14"
tags: []
draft: false
featured: false
readingTime: 5
---
## 1.多git需求
大部分人会有本地多git账号需求，用来管理不同git归属仓库(如公司/学校/github等代码托管平台)，简单记录下配置过程。

## 2.git ssh机制
在[gitlab](https://so.csdn.net/so/search?q=gitlab&spm=1001.2101.3001.7020)，github上面拷贝代码时，通常用到了`git clone ssh://XXX`命令。其中ssh指`secure shell`（一种安全的[网络协议](https://so.csdn.net/so/search?q=%E7%BD%91%E7%BB%9C%E5%8D%8F%E8%AE%AE&spm=1001.2101.3001.7020)），git使用这种协议进行远程加密登录。
git使用SSH配置， 初始需要以下三个步骤
1. 使用秘钥生成工具`生成`rsa秘钥和公钥
2. 将rsa`公钥添加`到代码托管平台
3. 将rsa`秘钥添加`到ssh-agent中，为ssh client指定使用的秘钥文件  
<br />

## 3.具体步骤
比如当前需要管理两个git账户
### a.生成两个密钥
首先我们需要两个ssh密钥，对应你的两个身份(假设为public和private)
如果使用过git的话，我们基本已经拥有一个密钥了，比如通过以下命令生成了密钥：
`ssh-keygen -t rsa -C “youremail@gmail.com”`生成了`id_rsa`与`id_rsa.pub`，保存在了 `~/.ssh/`目录下。
然后我们需要再使用另外一个邮箱账号生成另外一个密钥，`ssh-keygen -t rsa -C “private_mail@gmail.com”`，⚠️注意此时需要重命名，否则会覆盖我们之前已经在使用的密钥。重命名后假设我们生成了`private_id_rsa`与`private_id_rsa.pub`。不要忘记将此private密钥加入到你的第二个git托管平台中。
### b.编辑ssh配置文件
编辑`~/.ssh/config`文件。如果该文件不存在的话，直接创建一个就好。内容如下：
```
# 原有，假设为github
Host github_public
Hostname ssh.github.com
IdentityFile ~/.ssh/id_rsa
port 22

# 新增，刚添加的第二个git账号
Host git_private
Hostname ssh.sankuai.com
IdentityFile ~/.ssh/private_id_rsa
port 22
```
修改完之后，在`git bash`运行以下命令（`@`后面的主机名为上面配置文件中填写的`Host`），检查是否正常。

**（注意：不要忘记将新增的密钥添加到对应的git托管平台）

```
ssh -T git@github_public
ssh -T git@git_private
```

如果能正常返回，就说明配置正常。

同样的方式你就可以配置更多的以SSH登录的不同git用户。

### c.使用
通过变换不同的Host，就可以自由使用期望的账号进行git clone及新建仓库了。
比如我要以公司账号clone与使用公司仓库，可以使用：
```
git clone git@git_private:RainPot/RainPot.sankuai.git
```