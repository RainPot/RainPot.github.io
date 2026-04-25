---
title: "剑指offer41-50"
description: "剑指offer"
date: "2020-04-13"
tags: ["Problems"]
draft: false
featured: false
readingTime: 6
---
## 41题目描述
和为S的连续正数序列  
小明很喜欢数学,有一天他在做数学作业时,要求计算出9~16的和,他马上就写出了正确答案是100。但是他并不满足于此,他在想究竟有多少种连续的正数序列的和为100(至少包括两个数)。没多久,他就得到另一组连续正数和为100的序列:18,19,20,21,22。现在把问题交给你,你能不能也很快的找出所有和为S的连续正数序列? Good Luck!  
输出描述:  
输出所有和为S的连续正数序列。序列内按照从小至大的顺序，序列间按照开始数字从小到大的顺序

## 思路
采用双指针策略，不需要使用队列，用队列反而变麻烦了。记录两个指针，一个大一个小，计算大小之间这个窗口的和。

## 代码
```
class Solution {
public:
    vector<vector<int> > FindContinuousSequence(int sum) 
    {
        vector<vector<int>> Sequences;
        if(sum < 3) return Sequences;
        int small = 1;
        int big = 2;
        int temp_sum = 3;
        int mid = (sum + 1) / 2;
        while(small < mid)
        {
            if(temp_sum == sum)
            {
                vector<int> temp_sequence;
                for(int i = small; i <= big; i++)
                    temp_sequence.push_back(i);
                Sequences.push_back(temp_sequence);
            }
            if(temp_sum > sum)
            {
                while(temp_sum > sum && small < mid)
                {
                    temp_sum -= small;
                    small++;
                }
                if(temp_sum == sum)
                {
                    vector<int> temp_sequence;
                    for(int i = small; i <= big; i++)
                        temp_sequence.push_back(i);
                    Sequences.push_back(temp_sequence);
                }
            }
            temp_sum += ++big;
        }
        return Sequences;
    }
};
```

## 42题目描述
和为S的两个数字  
输入一个递增排序的数组和一个数字S，在数组中查找两个数，使得他们的和正好是S，如果有多对数字的和等于S，输出两个数的乘积最小的。  
输出描述:  
对应每个测试案例，输出两个数，小的先输出。

## 思路1
同样采用双指针，从前往后遍历算和，和为要求的量后直接return，因为此时就算有其他满足条件的但此乘积一定是最小的

## 代码
```
class Solution {
public:
    vector<int> FindNumbersWithSum(vector<int> array,int sum) 
    {
        vector<int> Numbers;
        int flag = 0;
        if(array.size() < 2) return Numbers;
        for(int small = 0; small < (array.size() - 1); small++)
        {
            for(int big = small + 1; big < array.size(); big++)
            {
                if(array[small] + array[big] == sum)
                {
                    Numbers.push_back(array[small]);
                    Numbers.push_back(array[big]);
                    flag = 1;
                    break;
                }
            }
            if(flag == 1) break;
        }
        return Numbers;
    }
};
```

## 思路2
数列满足递增，设头尾两个指针
若ai + aj == sum，就是答案（相差越远乘积越小）  
若ai + aj > sum，aj肯定不是答案之一（前面已得出 i 前面的数已是不可能），j -= 1  
若ai + aj < sum，ai肯定不是答案之一（前面已得出 j 后面的数已是不可能），i += 1  
O(n)

## 代码
```
class Solution {
public:
    vector<int> FindNumbersWithSum(vector<int> array,int sum) {
        int left,right;
        left=0;
        right=array.size()-1;
        vector<int> result;
        while(left<right){
            if(array[left]+array[right]==sum){
                result.push_back(array[left]);
                result.push_back(array[right]);
                break;
            }
            if(array[left]+array[right]>sum){
                right--;
            }else{
                left++;
            }
        }
        return result;
    }
};
```

## 43题目描述
左旋转字符串  
汇编语言中有一种移位指令叫做循环左移（ROL），现在有个简单的任务，就是用字符串模拟这个指令的运算结果。对于一个给定的字符序列S，请你把其循环左移K位后的序列输出。例如，字符序列S=”abcXYZdef”,要求输出循环左移3位后的结果，即“XYZdefabc”。是不是很简单？OK，搞定它！

## 思路1
用substr函数截取字符串，然后前后调换位置即可。主要是熟悉函数的应用。

## 代码
```
class Solution {
public:
    string LeftRotateString(string str, int n) 
    {
        string s3 = "";
        if(str == "") return s3;
        string s1 = str.substr(0, n);
        string s2 = str.substr(n, str.size() - n);
        s3 = s2 + s1;
        return s3;
    }
};
```

## 思路2
剑指offer书上的方法，两次翻转字符串  原理：YX = (XTYT)T

## 代码
```
class Solution {
public:
    string LeftRotateString(string str, int n) {
        reverse(str.begin(), str.end());
        reverse(str.begin(), str.begin() + str.size() - n);
        reverse(str.begin() + str.size() - n, str.end());
        return str;
    }
};
```

## 44题目描述
翻转单词顺序序列  
牛客最近来了一个新员工Fish，每天早晨总是会拿着一本英文杂志，写些句子在本子上。同事Cat对Fish写的内容颇感兴趣，有一天他向Fish借来翻看，但却读不懂它的意思。例如，“student. a am I”。后来才意识到，这家伙原来把句子单词的顺序翻转了，正确的句子应该是“I am a student.”。Cat对一一的翻转这些单词顺序可不在行，你能帮助他么？

## 思路
此题需要一个字符一个字符进行处理 运用string之间相加的便利性进行顺序互换

## 代码
```
class Solution {
public:
    string ReverseSentence(string str) 
    {
        string Reverse = "";
        if(str.size() == 0) return Reverse;
        string tmp = "";
        for(int i = 0; i < str.size(); i++)
        {
            if(str[i] == ' ')
            {
                Reverse = " " + tmp + Reverse;
                tmp = "";
            }
            else
                tmp += str[i];
        }
        if(tmp.size())
            Reverse = tmp + Reverse;
        return Reverse;
    }
};
```

## 45题目描述
扑克牌顺子  
LL今天心情特别好,因为他去买了一副扑克牌,发现里面居然有2个大王,2个小王(一副牌原本是54张^_^)...他随机从中抽出了5张牌,想测测自己的手气,看看能不能抽到顺子,如果抽到的话,他决定去买体育彩票,嘿嘿！！“红心A,黑桃3,小王,大王,方片5”,“Oh My God!”不是顺子.....LL不高兴了,他想了想,决定大\小 王可以看成任何数字,并且A看作1,J为11,Q为12,K为13。上面的5张牌就可以变成“1,2,3,4,5”(大小王分别看作2和4),“So Lucky!”。LL决定去买体育彩票啦。 现在,要求你使用这幅牌模拟上面的过程,然后告诉我们LL的运气如何， 如果牌能组成顺子就输出true，否则就输出false。为了方便起见,你可以认为大小王是0。

## 思路
这题主要是阅读理解..写的花里胡哨的。 思路是先对抽到的进行排序，再看两两间像差多少。king的话作为计数，弥补相差过多。

## 代码
```
class Solution {
public:
    bool IsContinuous( vector<int> numbers ) 
    {
        if(numbers.size() == 0) return 0;
        int flag = 1;
        int king = 0;
        sort(numbers.begin(), numbers.end());
        for(int i = 0; i < numbers.size() - 1; i++)
        {
            if(numbers[i] == 0)
            {
                king++;
                continue;
            }
            if(numbers[i+1] - numbers[i] == 0)
            {
                flag = 0;
                break;
            }
            if(numbers[i+1] - numbers[i] == 1) continue;
            else
            {
                int a = numbers[i+1] - numbers[i] - 1;
                king -= a;
                if(king < 0)
                {
                    flag = 0;
                    break;
                }
            }
        }
        return flag;
    }
};
```

## 46题目描述
孩子们的游戏（圆圈中最后剩下的数）  
每年六一儿童节,牛客都会准备一些小礼物去看望孤儿院的小朋友,今年亦是如此。HF作为牛客的资深元老,自然也准备了一些小游戏。其中,有个游戏是这样的:首先,让小朋友们围成一个大圈。然后,他随机指定一个数m,让编号为0的小朋友开始报数。每次喊到m-1的那个小朋友要出列唱首歌,然后可以在礼品箱中任意的挑选礼物,并且不再回到圈中,从他的下一个小朋友开始,继续0...m-1报数....这样下去....直到剩下最后一个小朋友,可以不用表演,并且拿到牛客名贵的“名侦探柯南”典藏版(名额有限哦!!^_^)。请你试着想下,哪个小朋友会得到这份礼品呢？(注：小朋友的编号是从0到n-1)

如果没有小朋友，请返回-1

## 思路
利用列表的函数，建立一个指针进行逐个元素遍历，遍历到哪个元素哪个元素弹出，然后继续后续的遍历直到只剩一个元素。  
这里要注意最后一个弹出时 指针要指向vector开头，如果没有此操作程序无法运行。

## 代码
```
class Solution 
{
public:
    int LastRemaining_Solution(int n, int m)
    {
        if(n <= 0 || m <= 0) return -1;
        vector<int> ALL;
        for(int i = 0; i < n; i++)
            ALL.push_back(i);
        int point = 0;
        int left = n;
        while(left > 1)
        {
            for(int i = 0; i < m - 1; i++)
            {
                if(point == (left - 1))
                    point = 0;
                else
                    point++;
            }
            ALL.erase(ALL.begin() + point);
            if(point == (left - 1)) point = 0;
            left--;
        }
        return ALL[0];
    }
};
```

## 47题目描述
求1+2+3+...+n  
求1+2+3+...+n，要求不能使用乘除法、for、while、if、else、switch、case等关键字及条件判断语句（A?B:C）。

## 思路
这些限制条件里面没有限制递归...于是直接用了递归。

## 代码
```
class Solution {
public:
    int Sum_Solution(int n) 
    {
        if(n == 1) return 1;
        return n + Sum_Solution(n - 1);
    }
};
```

## 48题目描述
不用加减乘除做加法  
写一个函数，求两个整数之和，要求在函数体内不得使用+、-、*、/四则运算符号。

## 思路
//step1:按位与是查看两个数哪些二进制位都为1，这些都是进位位，结果需左移一位，表示进位后的结果  
//step2:异或是查看两个数哪些二进制位只有一个为1，这些是非进位位，可以直接加、减，结果表示非进位位进行加操作后的结果  
//step3:n1&n2是查看有没有进位位了，如果有，需要重复step1、step2；如果没有，保留n1、n2上二进制为1的部分，用或将之合为一个数，即为最后结果  

## 代码
```
class Solution {
public:
    int Add(int num1, int num2)
    {
        int n1,n2;
        n1=(num1&num2)<<1;
        n2=num1^num2;
        while(n1&n2)
        {
            num1=n1;num2=n2;
            n1=(num1&num2)<<1;
            n2=num1^num2;
        }
        return n1|n2;
    }
};
```

## 49题目描述
把字符串转换成整数  
将一个字符串转换成一个整数，要求不能使用字符串转换整数的库函数。 数值为0或者字符串不是一个合法的数值则返回0  
输入描述：  
输入一个字符串,包括数字字母符号,可以为空  
输出描述：  
如果是合法的数值表达则返回该数字，否则返回0  
输入：  
+2147483647  
    1a33  
输出：  
2147483647  
0

## 思路
逐位判断，是否在0-9之中，在则转为int存入vector不在则直接返回0。最后按位将存入vecotr的数组合起来。这里要注意超出int范围的情况，超出范围需要返回0；  （注：判断0-9不用单个判断！直接使用str[i]>='0'&&str[i]<='9'）

## 代码
```
class Solution {
public:
    int StrToInt(string str) 
    {
        long int a = 0;
        int flag = 1;
        vector<int> single;
        for(int i = 0; i < str.size(); i++)
        {
            if(i == 0 && str[i] == '+') continue;
            if(i == 0 && str[i] == '-')
            {
                flag = 0;
                continue;
            }
            if(i != 0 && str[i] == '0' || str[i] == '1' || str[i] == '2' || str[i] == '3' || str[i] == '4' || str[i] == '5' || str[i] == '6' || str[i] == '7' || str[i] == '8' || str[i] == '9')
                single.push_back(int(str[i]) - 48);
            else
                return 0;
        }
        int ten = single.size() - 1;
        for(int i = 0; i < single.size(); i++)
        {
            a += (single[i] * pow(10, ten));
            ten--;
        }
        int fin = 0;
        if(flag == 0) a = -a;
        if(a < -2147483648 || a > 2147483647) return 0;
        else fin = a;
        return fin;
    }
};
```

## 50题目描述
数组中重复的数字  
在一个长度为n的数组里的所有数字都在0到n-1的范围内。 数组中某些数字是重复的，但不知道有几个数字是重复的。也不知道每个数字重复几次。请找出数组中任意一个重复的数字。 例如，如果输入长度为7的数组{2,3,1,0,2,5,3}，那么对应的输出是第一个重复的数字2。

## 思路
建立一个辅助vector用来记录每个数字出现的次数，当有一个出现2次时，直接返回。如果到最后还没有则返回false。  

## 代码
```
class Solution {
public:
    // Parameters:
    //        numbers:     an array of integers
    //        length:      the length of array numbers
    //        duplication: (Output) the duplicated number in the array number
    // Return value:       true if the input is valid, and there are some duplications in the array number
    //                     otherwise false
    bool duplicate(int numbers[], int length, int* duplication) 
    {
        vector<int> count(10, 0);
        for(int i = 0; i < length; i++)
        {
            count[numbers[i]]++;
            if(count[numbers[i]] >= 2)
            {
                *duplication = numbers[i];
                return true;
            }
        }
        return false;
    }
};
```
    
    


