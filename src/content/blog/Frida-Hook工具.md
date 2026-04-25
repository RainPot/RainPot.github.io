---
title: "Frida Hook工具"
description: "Frida hook工具简单总结"
date: "2023-02-27"
tags: []
draft: false
featured: false
readingTime: 5
---
Frida工具官网：[https://frida.re/](https://frida.re/)  

开源地址：[https://github.com/frida/frida](https://github.com/frida/frida)  

![](../../images/Pasted%20image%2020230227220605.png)

# 0.Hook
Hook中文翻译为“钩子”，实际上就是一段程序代码，挂在某个调用或方法上。每当有调用或方法被触发，就会走到Hook这段代码当中，Hook代码可以捕获消息做自己的动作，从而改变本身调用所得到的结果，本质就是`劫持函数调用`


# 1.Frida
Frida是一款基于Python + JavaScript的开源、免费、跨平台hook框架，可以实现对Windows、Linux、Android、iOS、MacOS应用程序的动态插桩需求。主要使用动态二进制插桩技术。插桩技术是指将额外的代码注入程序中以收集运行时的信息，可分为两种：一是源代码插桩【Source Code Instrumentation(SCI)】：额外代码注入到程序源代码中；二是二进制插桩【Binary Instrumentation】：额外代码注入到二进制可执行文件中，其又可分为两种：静态二进制插桩（程序执行前）与动态二进制插桩（程序执行中runtime）。

整体Frida分为客户端于服务端：
- 客户端：使用python，主要作用：1.负责与服务端通信 2.定义hook的方法，以js代码形式传输至服务端，由服务端实现对应方法的hook
- 服务端：服务端接受`JS`代码并将其注入到目标进程中，操作内存空间然后给客户端发送消息。服务端分为两种，一种是正常的[`frida-server`](https://github.com/frida/frida/releases)，如果我们能够获取到设备的Root权限（比如安卓手机Root权限），可以使用[`frida-server`](https://github.com/frida/frida/releases)获得手机系统层级权限完成hook。若我们当前没有Root权限（或iOS手机未越狱），我们可以使用[`frida-gadget`](https://github.com/frida/frida/releases)，安卓.so iOS .dylib植入到目标APP中进行重打包，获取APP级别权限，完成对APP的hook。

# 2.使用
下面是Frida官方提供的一个demo：
> 其中中间部分是js代码，上下部分是python；  
> python部分只是单纯的为了将js代码发送到设备而已，核心hook行为还是在js部分实现；  
> 1，js语言是弱语言，不对变量类型做强检查，所以我们可以都用`var`表示；  
> 2，java中的类都用`java.use`获取；  
> 3，js代码function大括号内部是用于hook的主要代码，其余部分基本不变

```python
import frida, sys
def on_message(message, data):
    if message['type'] == 'send':
        print("[*] {0}".format(message['payload']))
    else:
        print(message)

jscode = """
Java.perform(function () {
  // Function to hook is defined here
  var MainActivity = Java.use('com.example.seccon2015.rock_paper_scissors.MainActivity');

  // Whenever button is clicked
  var onClick = MainActivity.onClick;
  onClick.implementation = function (v) {
    // Show a message to know that the function got called
    send('onClick');

    // Call the original onClick handler
    onClick.call(this, v);

    // Set our values after running the original onClick handler
    this.m.value = 0;
    this.n.value = 1;
    this.cnt.value = 999;

    // Log to the console that it's done, and we should have the flag!
    console.log('Done:' + JSON.stringify(this.cnt));
  };
});
"""

process = frida.get_usb_device().attach('com.example.seccon2015.rock_paper_scissors')
script = process.create_script(jscode)
script.on('message', on_message)
print('[*] Running CTF')
script.load()
sys.stdin.read()
```
  

# 3.总结
Frida主要特点：
-   平台支持 Android、IOS、Windows、Linux、MacOS 等
-   在 Android 系统上，不仅支持对 Java 层的 Hook，还支持对 so 库文件 Native 层的 Hook
-   支持 Python 语法或 js 语法编写 Hook 脚本
-   有 VSCode 扩展，支持 Frida 语法智能感知

