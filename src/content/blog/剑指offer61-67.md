---
title: "剑指offer61-67"
description: "剑指offer"
date: "2020-04-17"
tags: ["Problems"]
draft: false
featured: false
readingTime: 6
---
## 61题目描述  
序列化二叉树  
请实现两个函数，分别用来序列化和反序列化二叉树  

二叉树的序列化是指：把一棵二叉树按照某种遍历方式的结果以某种格式保存为字符串，从而使得内存中建立起来的二叉树可以持久保存。序列化可以基于先序、中序、后序、层序的二叉树遍历方式来进行修改，序列化的结果是一个字符串，序列化时通过 某种符号表示空节点（#），以 ！ 表示一个结点值的结束（value!）。  

二叉树的反序列化是指：根据某种遍历顺序得到的序列化字符串结果str，重构二叉树。  

## 思路  
采用前序遍历，遇到空节点，存入一个特殊字符。运用递归。要熟练使用to_string() 及 stoi()，c_str() strcpy() substr() 的用法。

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
};
*/
class Solution {
public:
    void SerializeHelper(TreeNode *root, string &str)
    {
        if(root == NULL)
        {
            str += "N,";
            return;
        }
        str += to_string(root -> val);
        str += ",";
        SerializeHelper(root -> left, str);
        SerializeHelper(root -> right, str);
    }
    char* Serialize(TreeNode *root) 
    {    
        if(root == NULL) return NULL;
        string s = "";
        SerializeHelper(root, s);
        
        char* ret = new char[s.length() + 1];
        ret = strcpy(ret, s.c_str());
        return ret;
    }
    TreeNode* DeserializeHelper(string& s)
    {
        if(s.empty()) return NULL;
        if(s[0] == 'N')
        {
            s = s.substr(2);
            return NULL;
        }
        TreeNode* newNode = new TreeNode(stoi(s));
        s = s.substr(s.find(',') + 1);
        newNode -> left = DeserializeHelper(s);
        newNode -> right = DeserializeHelper(s);
        return newNode;
    }
    
    TreeNode* Deserialize(char *str) 
    {
        if(str == NULL) return NULL;
        string s(str);
        return DeserializeHelper(s);
    }
};
```

## 62题目描述 
二叉搜索树的第k个结点  
给定一棵二叉搜索树，请找出其中的第k小的结点。例如， （5，3，7，2，4，6，8）    中，按结点数值大小顺序第三小结点的值为4。

## 思路
采用递归。二叉搜索树的中序遍历的输出是从小到大。所以设置一个计数器，用递归中序遍历到第k个即结果就好。

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
};
*/
class Solution {
public:
    int count = 0;
    TreeNode* KthNode(TreeNode* pRoot, int k)
    {
        if(pRoot != NULL)
        {
            TreeNode* node = KthNode(pRoot -> left, k);
            if(node != NULL) return node;
            count++;
            if(count == k) return pRoot;
            node = KthNode(pRoot -> right, k);
            if(node != NULL) return node;
        }
        return NULL;
    }

    
};
```

## 63题目描述
数据流中的中位数  
如何得到一个数据流中的中位数？如果从数据流中读出奇数个数值，那么中位数就是所有数值排序之后位于中间的数值。如果从数据流中读出偶数个数值，那么中位数就是所有数值排序之后中间两个数的平均值。我们使用Insert()方法读取数据流，使用GetMedian()方法获取当前读取数据的中位数。  

## 思路
定义一个向量，用来保存数据流，用sort函数进行排序。

## 代码
```
class Solution {
public:
    vector<int> array;
    void Insert(int num)
    {
        array.push_back(num);
    }

    double GetMedian()
    { 
        sort(array.begin(), array.end());
        if(array.size() % 2 == 0) return (array[array.size() / 2] + array[array.size() / 2 - 1]) / 2.0;
        if(array.size() % 2 != 0) return array[array.size() / 2];
    }

};
```

## 64题目描述
滑动窗口的最大值  
给定一个数组和滑动窗口的大小，找出所有滑动窗口里数值的最大值。例如，如果输入数组{2,3,4,2,6,2,5,1}及滑动窗口的大小3，那么一共存在6个滑动窗口，他们的最大值分别为{4,4,6,6,6,5}； 针对数组{2,3,4,2,6,2,5,1}的滑动窗口有以下6个： {[2,3,4],2,6,2,5,1}， {2,[3,4,2],6,2,5,1}， {2,3,[4,2,6],2,5,1}， {2,3,4,[2,6,2],5,1}， {2,3,4,2,[6,2,5],1}， {2,3,4,2,6,[2,5,1]}。

## 思路
设置两个指针，代表窗口上下限，在窗口内部暴力查找最大值。 /还有一个双端队列的思路

## 代码
```
class Solution {
public:
    vector<int> maxInWindows(const vector<int>& num, unsigned int size)
    {
        vector<int> maxarray;
        if(num.empty()) return maxarray;
        int fast = size - 1, slow = 0;
        int max = 0;
        while(fast < num.size())
        {
            max = num[slow];
            for(int i = slow + 1; i <= fast; i++)
                if(num[i] > max) max = num[i];
            maxarray.push_back(max);
            fast++;
            slow++;
        }
        return maxarray;
    }
};
```

## 65题目描述
矩阵中的路径  
请设计一个函数，用来判断在一个矩阵中是否存在一条包含某字符串所有字符的路径。路径可以从矩阵中的任意一个格子开始，每一步可以在矩阵中向左，向右，向上，向下移动一个格子。如果一条路径经过了矩阵中的某一个格子，则该路径不能再进入该格子。  

## 思路
分析：回溯算法  
 这是一个可以用回朔法解决的典型题。首先，在矩阵中任选一个格子作为路径的起点。如果路径上的第i个字符不是ch，那么这个格子不可能处在路径上的  
第i个位置。如果路径上的第i个字符正好是ch，那么往相邻的格子寻找路径上的第i+1个字符。除在矩阵边界上的格子之外，其他格子都有4个相邻的格子。  
重复这个过程直到路径上的所有字符都在矩阵中找到相应的位置。  
　　由于回朔法的递归特性，路径可以被开成一个栈。当在矩阵中定位了路径中前n个字符的位置之后，在与第n个字符对应的格子的周围都没有找到第n+1个  
字符，这个时候只要在路径上回到第n-1个字符，重新定位第n个字符。  
　　由于路径不能重复进入矩阵的格子，还需要定义和字符矩阵大小一样的布尔值矩阵，用来标识路径是否已经进入每个格子。 当矩阵中坐标为（row,col）的  
格子和路径字符串中相应的字符一样时，从4个相邻的格子(row,col-1),(row-1,col),(row,col+1)以及(row+1,col)中去定位路径字符串中下一个字符  
如果4个相邻的格子都没有匹配字符串中下一个的字符，表明当前路径字符串中字符在矩阵中的定位不正确，我们需要回到前一个，然后重新定位。  
　　一直重复这个过程，直到路径字符串上所有字符都在矩阵中找到合适的位置

## 代码
```
class Solution {
public:
    bool hasPath(char* matrix, int rows, int cols, char* str)
    {
        if(rows <= 0 || cols <= 0 || str == NULL) return false;
        //bool* HasCount = new bool[rows * cols]();
        bool* HasCount = new bool[rows * cols];
        memset(HasCount,false,rows*cols);
        for(int i = 0; i < rows; i++)
        {
            for(int j = 0; j < cols; j++)
                if(HasPathHelper(matrix, rows, cols, str, HasCount, i, j)) return true;
        }
        return false;
    }
    
    bool HasPathHelper(char* matrix, int rows, int cols, char* str, bool* HasCount, int x, int y)
    {
        if(*str == '\0') return true;
        if(x < 0 || x >= rows || y < 0 || y >= cols) return false;
        if(HasCount[x * cols + y] || matrix[x * cols + y] != *str) return false;
        HasCount[x * cols + y] = true;
        bool temp = HasPathHelper(matrix, rows, cols, str+1, HasCount, x+1, y) 
            || HasPathHelper(matrix, rows, cols, str+1, HasCount, x, y+1)
            || HasPathHelper(matrix, rows, cols, str+1, HasCount, x-1, y)
            || HasPathHelper(matrix, rows, cols, str+1, HasCount, x, y-1);
        HasCount[x * cols + y] = false;
        return temp;
    }
};
```

## 66题目描述
机器人的运动范围  
地上有一个m行和n列的方格。一个机器人从坐标0,0的格子开始移动，每一次只能向左，右，上，下四个方向移动一格，但是不能进入行坐标和列坐标的数位之和大于k的格子。 例如，当k为18时，机器人能够进入方格（35,37），因为3+5+3+7 = 18。但是，它不能进入方格（35,38），因为3+5+3+8 = 19。请问该机器人能够达到多少个格子？  

## 思路
回溯法，采用递归。这里要注意要遍历所有格子，而不是找一个能包含最多格子的路径，在路径上可以任意走动。所以在计算时直接加1即可，次数不需回溯。

## 代码
```
class Solution {
public:
    int movingCount(int threshold, int rows, int cols)
    {
        if(rows <= 0 || cols <= 0) return 0;
        bool* Count = new bool[rows * cols];
        memset(Count, false, rows * cols);
        return movingCountHelper(threshold, rows, cols, 0, 0, Count);
    }
    
    int movingCountHelper(int threshold, int rows, int cols, int x, int y, bool* Count)
    {
        if(x < 0 || x >= rows || y < 0 || y >= cols) return 0;
        if(Count[x * cols + y] == 1) return 0;
        int col_sum = 0, row_sum = 0;
        int temp_x = x, temp_y = y;
        if(x == 0) row_sum = 0;
        if(y == 0) col_sum = 0;
        while(temp_x > 0)
        {
            row_sum += (temp_x % 10);
            temp_x = temp_x / 10; 
        }
        while(temp_y > 0)
        {
            col_sum += (temp_y % 10);
            temp_y = temp_y / 10;
        }
        if((row_sum + col_sum) <= threshold)
        {
            Count[x * cols + y] = 1;
            return 1 + movingCountHelper(threshold, rows, cols, x + 1, y, Count) + movingCountHelper(threshold, rows, cols, x - 1, y, Count)
                + movingCountHelper(threshold, rows, cols, x, y + 1, Count) + movingCountHelper(threshold, rows, cols, x, y - 1, Count);
        }
        
        return 0;
    }
};
```

## 67题目描述
剪绳子  
给你一根长度为n的绳子，请把绳子剪成整数长的m段（m、n都是整数，n>1并且m>1），每段绳子的长度记为k[0],k[1],...,k[m]。请问k[0]xk[1]x...xk[m]可能的最大乘积是多少？例如，当绳子的长度是8时，我们把它剪成长度分别为2、3、3的三段，此时得到的最大乘积是18。  

## 思路1
动态规划  
①求一个问题的最优解；   
②整体的问题的最优解是依赖于各个子问题的最优解；   
③小问题之间还有相互重叠的更小的子问题；   
④从上往下分析问题，从下往上求解问题；  

## 代码
```
public class Solution 
{
    public int cutRope(int n) 
    {
       // n<=3的情况，m>1必须要分段，例如：3必须分成1、2；1、1、1 ，n=3最大分段乘积是2,
        if(n==2)
            return 1;
        if(n==3)
            return 2;
        int[] dp = new int[n+1];
        /*
        下面3行是n>=4的情况，跟n<=3不同，4可以分很多段，比如分成1、3，
        这里的3可以不需要再分了，因为3分段最大才2，不分就是3。记录最大的。
         */
        dp[1]=1;
        dp[2]=2;
        dp[3]=3;
        int res=0;//记录最大的
        for (int i = 4; i <= n; i++) {
            for (int j = 1; j <=i/2 ; j++) {
                res=Math.max(res,dp[j]*dp[i-j]);
            }
            dp[i]=res;
        }
        return dp[n];
    }
}
```

## 思路2
贪婪算法  
贪婪解法： 当n大于等于5时，我们尽可能多的剪长度为3的绳子；当剩下的绳子长度为4时，把绳子剪成两段长度为2的绳子。 为什么选2，3为最小的子问题？因为2，3包含于各个问题中，如果再往下剪得话，乘积就会变小。 为什么选长度为3？因为当n≥5时，3(n−3)≥2(n−2)  
https://www.nowcoder.com/questionTerminal/57d85990ba5b440ab888fc72b0751bf8?f=discussion

## 代码
```
class Solution {
public:
    int cutRope(int number) 
    {
        if(number < 2) return 0;
        if(number == 3) return 2;
        if(number == 2) return 1;
        int threecount = number / 3;
        if(number - (threecount * 3) == 1) threecount--;
        int twocount = (number - (threecount * 3)) / 2;
        return int(pow(3, threecount))*int(pow(2, twocount));
    }
};
```