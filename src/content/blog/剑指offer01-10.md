---
title: "剑指offer01-10"
description: "剑指offer"
date: "2020-03-23"
tags: ["Problems"]
draft: false
featured: false
readingTime: 6
---
## 01题目描述
```
在一个二维数组中（每个一维数组的长度相同），每一行都按照从左到右递增的顺序排序，每一列都按照从上到下递增的顺序排序。请完成一个函数，输入这样的一个二维数组和一个整数，判断数组中是否含有该整数。
```

## 思路
注意这个数组的特点，从左到右递增，从上到下递增，我的思路是利用这个特点进行最简单的遍历查找。  
一行一行进行比较，首先从第一行开始，判断行的首元素与target大小，如果首元素大，直接判定数组不包涵此target，如果相等返回true，如果首元素小，从行末往前进行遍历，判断target与每个元素大小，如果元素大，继续向前比，如果元素小，跳出循环进行下一行的比较

**注意！！**编好之后一直堆栈溢出，才发现是没有判断数组是否为空，这点以后一定要注意。

## 代码
```
class Solution {
public:
    bool Find(int target, vector<vector<int> > array)
    {
        
        if (array.empty())return false;
        for(int i=0;i < array.size(); i++)
        {
            if(array[i].empty())continue;
            if(array[i][0] > target) return false;
            else if(target == array[i][0]) return true;
            else if(target > array[i][0])
            {
                for(int j=(array[i].size() - 1);j>0;j--)
                {
                    if(target == array[i][j]) return true;
                    else if(target < array[i][j]) continue;
                    else if(target > array[i][j]) break;
                }
            }
        }
        return false;
    }
};
```



## 02题目描述
```
请实现一个函数，将一个字符串中的每个空格替换成“%20”。例如，当字符串为We Are Happy.则经过替换之后的字符串为We%20Are%20Happy。
```

## 思路
这里注意一个重点是将一个字符替换成3个字符，所以不能简单搜索并替换，要考虑多加进去的两个字符，所以简单思路为明白了每一个空格就会多两个字符这个关键信息，首先统计空格个数，再算出来更改后字符串长度，再从后向前复制原始字符串内容到新字符串中，与此同时替换掉空格。

## 代码
```
class Solution
{
public:
	void replaceSpace(char *str,int length) 
    {
        int i = 0;
        int numSpace = 0;
        int newLen = 0;
        while(str[i] != '\0')
        {
            if(str[i] == ' ')
            {
                numSpace++;
            }
            i++;
        }
        newLen = i + numSpace * 2;
        for(int j = i; j >= 0, newLen >= 0;)
        {
            if(str[j] == ' ')
            {
                str[newLen--] = '0';
                str[newLen--] = '2';
                str[newLen--] = '%';
                j--;
            }
            else
            {
                str[newLen--] = str[j--];
            }
        }
	}
};
```

## 03题目描述
```
输入一个链表，按链表从尾到头的顺序返回一个ArrayList。
```

## 思路1
这一题主要熟悉一下链表的操作及栈操作。第一个思路：从头到尾遍历链表，压入栈  然后从栈中弹出送入vector中。 第二个思路：

## 代码
```
/**
*  struct ListNode {
*        int val;
*        struct ListNode *next;
*        ListNode(int x) :
*              val(x), next(NULL) {
*        }
*  };
*/
class Solution 
{
public:
    vector<int> printListFromTailToHead(ListNode* head) 
    {
        vector<int> value;
        ListNode *p = NULL;
        p = head;
        stack<int> stk;
        while(p != NULL)
        {
            stk.push(p -> val);
            p = p -> next;
        }
        while(!stk.empty())
        {
            value.push_back(stk.top());
            stk.pop();
        }
        return value;
    }
};
```

## 思路2
按顺序遍历链表，将值放入array中，再用vector的翻转函数进行翻转。

## 代码
```
class Solution 
{
public:
    vector<int> printListFromTailToHead(ListNode* head) 
    {
        vector<int> value;
        ListNode* p = NULL;
        p = head;
        while(p != NULL)
        {
            value.push_back(p -> val);
            p = p -> next;
        }
        
        reverse(value.begin(), value.end());
        return value;
    }
};
```

## 04题目描述
```
输入某二叉树的前序遍历和中序遍历的结果，请重建出该二叉树。假设输入的前序遍历和中序遍历的结果中都不含重复的数字。例如输入前序遍历序列{1,2,4,7,3,5,6,8}和中序遍历序列{4,7,2,1,5,3,8,6}，则重建二叉树并返回。
```
## 思路
主要是要清楚前序遍历后序遍历的规律，采用递归的思想，找到根节点及此节点下面的左子树，右子树，送入递归。

## 代码
```
/**
 * Definition for binary tree
 * struct TreeNode {
 *     int val;
 *     TreeNode *left;
 *     TreeNode *right;
 *     TreeNode(int x) : val(x), left(NULL), right(NULL) {}
 * };
 */
class Solution {
public:
    TreeNode* reConstructBinaryTree(vector<int> pre,vector<int> vin) 
    {
        if(pre.size() == 0 || vin.size() == 0)
            return NULL;
        return reConstructBinaryTreeIT(pre, vin);
    }
    
    TreeNode* reConstructBinaryTreeIT(vector<int> pre, vector<int> vin)
    {
        if(pre.empty())
            return NULL;
        TreeNode* root = new TreeNode(pre[0]);
        auto num_root = find(vin.begin(), vin.end(), pre[0]);
        int left_num = num_root - vin.begin();
        
        root -> left = reConstructBinaryTreeIT(vector<int>(pre.begin() + 1, pre.begin() + 1 + left_num), vector<int>(vin.begin(), vin.begin() + left_num));
        root -> right = reConstructBinaryTreeIT(vector<int>(pre.begin() + 1 + left_num, pre.end()), vector<int>(vin.begin() + 1 + left_num, vin.end()));
        return root;
    }
};
```

## 05题目描述
```
用两个栈来实现一个队列，完成队列的Push和Pop操作。 队列中的元素为int类型。
```

## 思路
两个栈实现队列，因为栈的输出与队列相反，使用一个最原始的思路就是将输入压入一个栈，输出时将一个栈输入到另一个栈，这样另一个栈出栈的输出就是队列的顺序，与此同时还需要将第一个栈的这个输出pop出来，故再将第二个栈的pop完的剩余元素再次压入第一个栈中，此为一个pop过程。

## 代码
```
class Solution
{
public:
    void push(int node) {
        stack1.push(node);
    }

    int pop() {
        while(!stack1.empty())
        {
            stack2.push(stack1.top());
            stack1.pop();
        }
        int pop_num = stack2.top();
        stack2.pop();
        while(!stack2.empty())
        {
            stack1.push(stack2.top());
            stack2.pop();
        }
        return pop_num;
    }

private:
    stack<int> stack1;
    stack<int> stack2;
};
```

## 06题目描述
```
把一个数组最开始的若干个元素搬到数组的末尾，我们称之为数组的旋转。
输入一个非递减排序的数组的一个旋转，输出旋转数组的最小元素。
例如数组{3,4,5,1,2}为{1,2,3,4,5}的一个旋转，该数组的最小值为1。
NOTE：给出的所有元素都大于0，若数组大小为0，请返回0。
```

## 思路
本题主要在于理解非递减序列。非递减序列: 1,2,4,5,5,5,6  递增序列:1,2,4,5,6,7  当数组旋转后，最小数就很好找了。本题还有一个就是要多考虑特殊情况。各个情况考虑周全。

## 代码
```
class Solution {
public:
    int minNumberInRotateArray(vector<int> rotateArray) {
        if(rotateArray.empty())
            return 0;
        if(rotateArray.size() == 1) return rotateArray[0];
        for(int i = 0; i < rotateArray.size(); i++)
        {
            if (rotateArray[i + 1] < rotateArray[i])
                return rotateArray[i + 1];
            //if rotateArray[i + 1] >= rotateArray[i]
                //continue;
        }
        return rotateArray[0];
    }
};
```

## 07题目描述
```
大家都知道斐波那契数列，现在要求输入一个整数n，请你输出斐波那契数列的第n项（从0开始，第0项为0）。
n<=39
```

## 思路
主要得知道斐波那契数列的规则和题目的要求 斐波那契数列：F(1)=1，F(2)=1, F(n)=F(n - 1)+F(n - 2)

## 代码
```
class Solution {
public:
    int Fibonacci(int n) 
    {
        if(n == 0) return 0;
        if(n == 1 || n == 2) return 1;
        return Fibonacci(n - 1) + Fibonacci(n - 2);
    }
};
```

## 08题目描述
```
跳青蛙：一只青蛙一次可以跳上1级台阶，也可以跳上2级。求该青蛙跳上一个n级的台阶总共有多少种跳法（先后次序不同算不同的结果）。
```

## 思路
一个斐波那契数列的变种。主要考察递归

## 代码
```
class Solution 
{
public:
    int jumpFloor(int number) 
    {
        if(number == 0) return 0;
        if(number == 1) return 1;
        if(number == 2) return 2;
        return jumpFloor(number - 1) + jumpFloor(number - 2);
    }
};
```

## 09题目描述
```
变态跳青蛙：一只青蛙一次可以跳上1级台阶，也可以跳上2级……它也可以跳上n级。求该青蛙跳上一个n级的台阶总共有多少种跳法。
```

## 思路
从简到难，写出前几个需要的跳法，找到规律，就是斐波那契数列的变种，用递归即可。

## 代码
```
class Solution {
public:
    int jumpFloorII(int number) 
    {
        if(number == 1) return 1;
        return jumpFloorII(number - 1) + jumpFloorII(number - 1);
    }
};
```

## 10题目描述
```
矩形覆盖：我们可以用2*1的小矩形横着或者竖着去覆盖更大的矩形。请问用n个2*1的小矩形无重叠地覆盖一个2*n的大矩形，总共有多少种方法？

比如n=3时，2*3的矩形块有3种覆盖方法：
```

## 思路
还是写出前几个的覆盖数，寻找规律，可以察觉又是斐波那契数列，此时不要忘记特殊情况0的处理。

##代码
```
class Solution {
public:
    int rectCover(int number) {
        if(number == 0) return 0;
        if(number == 1) return 1;
        if(number == 2) return 2;
        return rectCover(number - 2) + rectCover(number - 1);
    }
};
```