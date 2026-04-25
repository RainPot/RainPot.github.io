---
title: "剑指offer11-20"
description: "剑指offer"
date: "2020-03-25"
tags: ["Problems"]
draft: false
featured: false
readingTime: 6
---
## 11题目描述
二进制中1的个数：

输入一个整数，输出该数二进制表示中1的个数。其中负数用补码表示。

## 思路
首先要明白几个常识 1.计算机中整数都是以补码存储，所以此题不需考虑正负问题 2.按位与操作&要熟悉。 

题解思路：如果一个整数不为0，那么这个整数至少有一位是1。如果我们把这个整数减1，那么原来处在整数最右边的1就会变为0，原来在1后面的所有的0都会变成1(如果最右边的1后面还有0的话)。其余所有位将不会受到影响。
举个例子：一个二进制数1100，从右边数起第三位是处于最右边的一个1。减去1后，第三位变成0，它后面的两位0变成了1，而前面的1保持不变，因此得到的结果是1011.我们发现减1的结果是把最右边的一个1开始的所有位都取反了。这个时候如果我们再把原来的整数和减去1之后的结果做与运算，从原来整数最右边一个1那一位开始所有位都会变成0。如1100&1011=1000.也就是说，把一个整数减去1，再和原整数做与运算，会把该整数最右边一个1变成0.那么一个整数的二进制有多少个1，就可以进行多少次这样的操作。

## 代码
```
class Solution {
public:
     int  NumberOf1(int n) 
     {
         int count = 0;
         while(n != 0)
         {
             count++;
             n = n & (n - 1);
         }
         return count;
     }
};
```

## 12题目描述
数值的整数次方：

给定一个double类型的浮点数base和int类型的整数exponent。求base的exponent次方。

保证base和exponent不同时为0

## 思路
本题看题解 如果不用pow函数则需要充分考虑base exponent的各种极端情况， 我使用了pow函数，直接ac了。。

## 代码
```
class Solution {
public:
    double Power(double base, int exponent) {
        //if(base == 0) return 0.0;
        //if(exponent == 0) return 1.0;
        return pow(base, exponent);
    }
};
```

## 13题目描述
调整数组顺序使奇数位于偶数前面：

输入一个整数数组，实现一个函数来调整该数组中数字的顺序，使得所有的奇数位于数组的前半部分，所有的偶数位于数组的后半部分，并保证奇数和奇数，偶数和偶数之间的相对位置不变。

## 思路1
采用最暴力的方法，类似冒泡排序，两个循环，相邻两个数进行对比，如果前面为偶数后面为奇数 则两者互换。

## 代码
```
class Solution 
{
public:
    void reOrderArray(vector<int> &array) 
    {
        for(int i = 0; i < array.size(); i++)
        {
            for(int j = 0; j < array.size(); j++)
            {
                if(((array[j] % 2) == 0) && (array[j + 1] % 2) == 1)
                {
                    int temp = array[j];
                    array[j] = array[j + 1];
                    array[j + 1] = temp;
                }
                else continue;
            }
        }
    }
};
```

## 思路2
再创建一个数组，遇见偶数就存入，同时在原数组中删除，最后再存入原数组中。这里主要熟悉vector迭代器的使用。

## 代码
```
class Solution{
public:
    void reOrderArray(vector<int> &array) {
 
        vector<int> array_temp;
        vector<int>::iterator ib1, ie1;
        ib1 = array.begin();
 
 
        for (; ib1 != array.end();){            //遇见偶数，就保存到新数组，同时从原数组中删除
            if (*ib1 % 2 == 0) {
                array_temp.push_back(*ib1);
                ib1 = array.erase(ib1);
            }
            else{
                ib1++;
            }
 
        }
        vector<int>::iterator ib2, ie2;
        ib2 = array_temp.begin();
        ie2 = array_temp.end();
 
        for (; ib2 != ie2; ib2++)             //将新数组的数添加到老数组
        {
            array.push_back(*ib2);
        }
    }
};

```

## 14题目描述
链表中倒数第k个结点：

输入一个链表，输出该链表中倒数第k个结点。

## 思路
首先计算出链表长度，新建一个指针指向表头，然后向后遍历到length - k的结点就可以。思路比较简单，此题主要是特殊情况的判断，对于原链表和K的判断一定要考虑全面。

## 代码
```
/*
struct ListNode {
	int val;
	struct ListNode *next;
	ListNode(int x) :
			val(x), next(NULL) {
	}
};*/
class Solution {
public:
    ListNode* FindKthToTail(ListNode* pListHead, unsigned int k) 
    {
        if(pListHead == NULL || k <= 0)
            return NULL;
        int length = 0;
        ListNode* pre = pListHead;
        while(pListHead != NULL)
        {
            pListHead = pListHead -> next;
            length++;
        }
        if(k > length) return NULL;
        for(int i = 0; i < length - k; i++)
        {
            pre = pre -> next;
        }
        return pre;
    }
};
```

## 15题目描述
反转链表：

输入一个链表，反转链表后，输出新链表的表头。

## 思路
很普通的反转链表，卡了好长时间，才发现是判断的==没补全。。。。还是要注意一些细节

## 代码
```
/*
struct ListNode {
	int val;
	struct ListNode *next;
	ListNode(int x) :
			val(x), next(NULL) {
	}
};*/
class Solution {
public:
    ListNode* ReverseList(ListNode* pHead) 
    {
        if(pHead == NULL) return pHead;
        ListNode* now = pHead;
        ListNode* pre = NULL;
        ListNode* next = NULL;
        while(now != NULL)
        {
            next = now -> next;
            now -> next = pre;
            pre = now;
            now = next;
        }
        return pre;
    }
};
```

## 16题目描述
合并两个排序的链表：

输入两个单调递增的链表，输出两个链表合成后的链表，当然我们需要合成后的链表满足单调不减规则。

## 思路
本题最好不要在原始链表上进行操作而是新建一个链表，两两比较，小的加入到新链表末尾，这是最方便的做法。  还有第二种思路是递归，不太容易想到，明白即可。

## 代码
```
/*
struct ListNode {
	int val;
	struct ListNode *next;
	ListNode(int x) :
			val(x), next(NULL) {
	}
};*/
class Solution {
public:
    ListNode* Merge(ListNode* pHead1, ListNode* pHead2)
    {
        //if(pHead1 == NULL && pHead2 == NULL) return NULL;
        //if(pHead1 == NULL && pHead2 != NULL) return pHead2;
        //if(pHead1 != NULL && pHead2 == NULL) return pHead1;
        ListNode* new_head = new ListNode(1);
        ListNode* head = new_head;
        ListNode* cur = new_head;
        while(pHead1 != NULL && pHead2 != NULL)
        {
            if(pHead1 -> val <= pHead2 -> val)
            {
                cur -> next = pHead1;
                cur = cur -> next;
                pHead1 = pHead1 -> next;
            }
            else
            {
                cur -> next = pHead2;
                cur = cur -> next;
                pHead2 = pHead2 -> next;
            }
        }
        if(pHead1 != NULL) cur -> next = pHead1;
        if(pHead2 != NULL) cur -> next = pHead2;
        return head -> next;
    }
};
```

## 17题目描述
树的子结构：

输入两棵二叉树A，B，判断B是不是A的子结构。（ps：我们约定空树不是任意一个树的子结构）

## 思路
明显使用递归，这里需要使用两个递归来完成此任务，一个递归负责向下递推树1，第二个递归负责判断从此开始的树1子树与树2是否相同。

## 代码
```
/*
struct TreeNode {
	int val;
	struct TreeNode *left;
	struct TreeNode *right;
	TreeNode(int x) :
			val(x), left(NULL), right(NULL) {
	}
};*/
class Solution {
public:
    bool HasSubtree(TreeNode* pRoot1, TreeNode* pRoot2)
    {
        if(pRoot1 == NULL || pRoot2 == NULL) return false;
        if(pRoot1 -> val == pRoot2 -> val)
        {
            if(IsSubtree(pRoot1, pRoot2)) return true;
        }
        return HasSubtree(pRoot1 -> left, pRoot2) || HasSubtree(pRoot1 -> right, pRoot2);
    }
    
    bool IsSubtree(TreeNode* pRoot1, TreeNode* pRoot2)
    {
        if(pRoot2 == NULL) return true;
        if(pRoot1 == NULL) return false;
        if(pRoot1 -> val != pRoot2 -> val) return false;
        return (IsSubtree(pRoot1 -> left, pRoot2 -> left) && IsSubtree(pRoot1 -> right, pRoot2 -> right));
    }
};
```

## 18题目描述
二叉树的镜像：

操作给定的二叉树，将其变换为源二叉树的镜像。

## 思路
采用递归，这里为了避免太多判断，重点在于进行递归出口的判断(为空)，然后进行递归即可。

## 代码
```
/*
struct TreeNode {
	int val;
	struct TreeNode *left;
	struct TreeNode *right;
	TreeNode(int x) :
			val(x), left(NULL), right(NULL) {
	}
};*/
class Solution {
public:
    void Mirror(TreeNode *pRoot) 
    {
        if(pRoot == NULL) return;
        if(pRoot -> left == NULL && pRoot -> right == NULL) return;
        TreeNode* temp = NULL;
        temp = pRoot -> left;
        pRoot -> left = pRoot -> right;
        pRoot -> right = temp;
        Mirror(pRoot -> left);
        Mirror(pRoot -> right);
    }
};
```

## 19题目描述
顺时针打印矩阵：

输入一个矩阵，按照从外向里以顺时针的顺序依次打印出每一个数字，例如，如果输入如下4 X 4矩阵： 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 则依次打印出数字1,2,3,4,8,12,16,15,14,13,9,5,6,7,11,10.

## 思路
这个题说实话还挺难的，用自己的思路没做出来，采用了一个最清晰易懂的思路：首先模拟矩阵，找规律，发现设置好四个变量后每一圈对于一个方向都是相同的。设置4个变量，分别代表目前的上下左右情况，遍历完一圈后算作一次loop，上下左右都往内部缩一圈。这其中比较难想到的是特殊情况：矩阵为单独一列或者单独一行，要想让此case通过必须在第三四个循环上加上判断。

## 代码
```
class Solution {
public:
    vector<int> printMatrix(vector<vector<int> > matrix) {
        vector<int> printM;
        if(matrix.empty() || matrix[0].empty()) return printM;
        int rows = matrix.size();
        int colomns = matrix[0].size();
        int top = 0, left = 0, bottom = rows - 1, right = colomns - 1;
        while(top <= bottom && left <= right)
        {
            for(int i = left; i <= right; i++)
                printM.push_back(matrix[top][i]);
            for(int i = top + 1; i <= bottom; i++)
                printM.push_back(matrix[i][right]);
            if(top < bottom)
            {
                for(int i = right - 1; i >= left; i--)
                    printM.push_back(matrix[bottom][i]);
            }
            if(left < right)
            {
                for(int i = bottom - 1; i > top; i--)
                    printM.push_back(matrix[i][left]);
            }
            top++, left++, bottom--, right--;
        }
        return printM;
    }
};
```

## 20题目描述
包含min函数的栈：

定义栈的数据结构，请在该类型中实现一个能够得到栈中所含最小元素的min函数（时间复杂度应为O（1））。
注意：保证测试中不会当栈为空的时候，对栈调用pop()或者min()或者top()方法。

## 思路
使用两个栈，一个存放模拟真实的栈，第二个栈用来存放最小数，当新压入的数小于等于最小时压入第二个栈，此时要注意pop时，如果pop的是最小数，同样要在第二个栈中pop出。

## 代码
```
class Solution {
public:
    stack<int> s;
    stack<int> min_s;
    void push(int value) {
        s.push(value);
        if(min_s.empty()) min_s.push(value);
        if(!min_s.empty())
            if(value <= min_s.top())
                min_s.push(value);
    }
    void pop() {
        if(s.top() == min_s.top())
        {
            s.pop();
            min_s.pop();
        }
        else
            s.pop();
    }
    int top() {
        return s.top();
    }
    int min() {
        return min_s.top();
    }
};
```