---
title: "剑指offer31-40"
description: "剑指offer"
date: "2020-04-12"
tags: ["Problems"]
draft: false
featured: false
readingTime: 6
---
## 31题目描述
整数中1出现的次数（从1到n整数中1出现的次数）  
求出1~13的整数中1出现的次数,并算出100~1300的整数中1出现的次数？为此他特别数了一下1~13中包含1的数字有1、10、11、12、13因此共出现6次,但是对于后面问题他就没辙了。ACMer希望你们帮帮他,并把问题更加普遍化,可以很快的求出任意非负整数区间中1出现的次数（从1 到 n 中1出现的次数）。

## 思路
注意审题，1出现的次数，不是包含1的数有多少个。 问题不要想复杂了，使用简单的模10即可解决。

## 代码
```
class Solution {
public:
    int NumberOf1Between1AndN_Solution(int n)
    {
        int num = 0;  
        if(n < 1) return 0;
        for(int i = 1; i <= n; i++)
        {
            int temp = i;
            while(temp)
            {
                if(temp % 10 == 1) num++;
                temp = temp / 10;
            }
        }
        return num;
    }
};
```

## 32题目描述
把数组排成最小的数：  
输入一个正整数数组，把数组里所有数字拼接起来排成一个数，打印能拼接出的所有数字中最小的一个。例如输入数组{3，32，321}，则打印出这三个数字能排成的最小数字为321323。

## 思路
用vector自带sort函数进行排序，顺序由自己重新定义：a b转换成string后进行比较，ab<ba则保持顺序不变，ab>ba表示后面的要放到前面。这里需要熟悉vector的sort函数以及to_string，string之间的比较。https://blog.csdn.net/ihadl/article/details/7400929

## 代码
```
class Solution {
public:
    static bool exchange(int i, int j)
    {
        string A = "";
        string B = "";
        A += to_string(i);
        A += to_string(j);
        B += to_string(j);
        B += to_string(i);
        return A < B;
    }
    
    string PrintMinNumber(vector<int> numbers) 
    {
        string result = "";
        if(numbers.empty()) return result;
        sort(numbers.begin(), numbers.end(), exchange);
        for(int i = 0; i < numbers.size(); i++)
            result += to_string(numbers[i]);
        return result;
    }
};
```

## 33题目描述
丑数:  
把只包含质因子2、3和5的数称作丑数（Ugly Number）。例如6、8都是丑数，但14不是，因为它包含质因子7。 习惯上我们把1当做是第一个丑数。求按从小到大的顺序的第N个丑数。

## 思路
链接：https://www.nowcoder.com/questionTerminal/6aa9e04fc3794f68acf8778237ba065b
来源：牛客网

通俗易懂的解释：
首先从丑数的定义我们知道，一个丑数的因子只有2,3,5，那么丑数p = 2 ^ x * 3 ^ y * 5 ^ z，换句话说一个丑数一定由另一个丑数乘以2或者乘以3或者乘以5得到，那么我们从1开始乘以2,3,5，就得到2,3,5三个丑数，在从这三个丑数出发乘以2,3,5就得到4，6,10,6，9,15,10,15,25九个丑数，我们发现这种方***得到重复的丑数，而且我们题目要求第N个丑数，这样的方法得到的丑数也是无序的。那么我们可以维护三个队列：  
（1）丑数数组： 1  
乘以2的队列：2  
乘以3的队列：3  
乘以5的队列：5  
选择三个队列头最小的数2加入丑数数组，同时将该最小的数乘以2,3,5放入三个队列；  
（2）丑数数组：1,2  
乘以2的队列：4  
乘以3的队列：3，6  
乘以5的队列：5，10  
选择三个队列头最小的数3加入丑数数组，同时将该最小的数乘以2,3,5放入三个队列；  
（3）丑数数组：1,2,3  
乘以2的队列：4,6  
乘以3的队列：6,9  
乘以5的队列：5,10,15  
选择三个队列头里最小的数4加入丑数数组，同时将该最小的数乘以2,3,5放入三个队列；  
（4）丑数数组：1,2,3,4  
乘以2的队列：6，8  
乘以3的队列：6,9,12  
乘以5的队列：5,10,15,20  
选择三个队列头里最小的数5加入丑数数组，同时将该最小的数乘以2,3,5放入三个队列；  
（5）丑数数组：1,2,3,4,5  
乘以2的队列：6,8,10，  
乘以3的队列：6,9,12,15  
乘以5的队列：10,15,20,25  
选择三个队列头里最小的数6加入丑数数组，但我们发现，有两个队列头都为6，所以我们弹出两个队列头，同时将12,18,30放入三个队列；  
……………………
疑问：  
1.为什么分三个队列？  
丑数数组里的数一定是有序的，因为我们是从丑数数组里的数乘以2,3,5选出的最小数，一定比以前未乘以2,3,5大，同时对于三个队列内部，按先后顺序乘以2,3,5分别放入，所以同一个队列内部也是有序的；  
2.为什么比较三个队列头部最小的数放入丑数数组？  
因为三个队列是有序的，所以取出三个头中最小的，等同于找到了三个队列所有数中最小的。  
实现思路：  
我们没有必要维护三个队列，只需要记录三个指针显示到达哪一步；“|”表示指针,arr表示丑数数组；  
（1）1  
|2  
|3  
|5  
目前指针指向0,0,0，队列头arr[0] * 2 = 2,  arr[0] * 3 = 3,  arr[0] * 5 = 5  
（2）1 2  
2 |4  
|3 6  
|5 10  
目前指针指向1,0,0，队列头arr[1] * 2 = 4,  arr[0] * 3 = 3, arr[0] * 5 = 5  
（3）1 2 3  
2| 4 6  
3 |6 9  
|5 10 15  
目前指针指向1,1,0，队列头arr[1] * 2 = 4,  arr[1] * 3 = 6, arr[0] * 5 = 5  

## 代码
```
class Solution {
public:
    int GetUglyNumber_Solution(int index) {
        if (index < 7)return index;
        vector<int> res(index);
        res[0] = 1;
        int t2 = 0, t3 = 0, t5 = 0, i;
        for (i = 1; i < index; ++i)
        {
            res[i] = min(res[t2] * 2, min(res[t3] * 3, res[t5] * 5));
            if (res[i] == res[t2] * 2)t2++;
            if (res[i] == res[t3] * 3)t3++;
            if (res[i] == res[t5] * 5)t5++;
        }
        return res[index - 1];
    }
};

```

## 34题目描述
第一个只出现一次的字符  
在一个字符串(0<=字符串长度<=10000，全部由字母组成)中找到第一个只出现一次的字符,并返回它的位置, 如果没有则返回 -1（需要区分大小写）。

## 思路1
建立两个辅助数组和一个辅助字符串。第一个辅助数组count用来记录每个字符出现的次数，第二个辅助数组address用来记录字符出现的地址，辅助字符串用来记录出现的字符。三者在位置上对应。遍历整个字符串，直接将出现的字符相应属性记录在辅助数组与字符串中即可。 最后遍历count找到第一个为1的index，其对应的address就是这个字符的位置。

## 代码
```
class Solution {
public:
    int FirstNotRepeatingChar(string str) 
    {
        int flag = 0;
        vector<int> count;
        vector<char> character;
        vector<int> address;
        for(int i = 0; i < str.length(); i++)
        {
            flag = 0;
            if(count.empty()) 
            {
                count.push_back(1);
                character.push_back(str[i]);
                address.push_back(i);
                continue;
            }
            for(int j = 0; j < character.size(); j++)
            {
                if(str[i] == character[j])
                {
                    count[j]++;
                    flag = 1;
                }
            }
            if(flag) continue;
            count.push_back(1);
            character.push_back(str[i]);
            address.push_back(i);
        }

        for(int i = 0; i < count.size(); i++)
        {
            if(count[i] == 1) return address[i];
        }
        return -1;
    }
};
```

## 思路2
使用STL的map(1对1关联容器)记录，  更加方便。

## 代码
```
class Solution {
public:
    int FirstNotRepeatingChar(string str) {
        map<char, int> mp;
        for(int i = 0; i < str.size(); ++i)
            mp[str[i]]++;
        for(int i = 0; i < str.size(); ++i){
            if(mp[str[i]]==1)
                return i;
        }
        return -1;
    }
};
```

## 35题目描述
数组中的逆序数  
在数组中的两个数字，如果前面一个数字大于后面的数字，则这两个数字组成一个逆序对。输入一个数组,求出这个数组中的逆序对的总数P。并将P对1000000007取模的结果输出。 即输出P%1000000007  
输入描述:  
```
题目保证输入的数组中没有的相同的数字

数据范围：

	对于%50的数据,size<=10^4

	对于%75的数据,size<=10^5

	对于%100的数据,size<=2*10^5
```

示例1：  
```
输入
1,2,3,4,5,6,7,0
输出
7
```

## 思路
思路分析：  
看到这个题目，我们的第一反应是顺序扫描整个数组。每扫描到一个数组的时候，逐个比较该数字和它后面的数字的大小。如果后面的数字比它小，则这两个数字就组成了一个逆序对。假设数组中含有n个数字。由于每个数字都要和O(n)这个数字比较，因此这个算法的时间复杂度为O(n^2)。  
我们以数组{7,5,6,4}为例来分析统计逆序对的过程。每次扫描到一个数字的时候，我们不拿ta和后面的每一个数字作比较，否则时间复杂度就是O(n^2)，因此我们可以考虑先比较两个相邻的数字。  

(a) 把长度为4的数组分解成两个长度为2的子数组；  
(b) 把长度为2的数组分解成两个成都为1的子数组；  
(c) 把长度为1的子数组 合并、排序并统计逆序对 ；  
(d) 把长度为2的子数组合并、排序，并统计逆序对；  
在上图（a）和（b）中，我们先把数组分解成两个长度为2的子数组，再把这两个子数组分别拆成两个长度为1的子数组。接下来一边合并相邻的子数组，一边统计逆序对的数目。在第一对长度为1的子数组{7}、{5}中7大于5，因此（7,5）组成一个逆序对。同样在第二对长度为1的子数组{6}、{4}中也有逆序对（6,4）。由于我们已经统计了这两对子数组内部的逆序对，因此需要把这两对子数组 排序 如上图（c）所示， 以免在以后的统计过程中再重复统计。  
接下来我们统计两个长度为2的子数组子数组之间的逆序对。合并子数组并统计逆序对的过程如下图如下图所示。  
我们先用两个指针分别指向两个子数组的末尾，并每次比较两个指针指向的数字。如果第一个子数组中的数字大于第二个数组中的数字，则构成逆序对，并且逆序对的数目等于第二个子数组中剩余数字的个数，如下图（a）和（c）所示。如果第一个数组的数字小于或等于第二个数组中的数字，则不构成逆序对，如图b所示。每一次比较的时候，我们都把较大的数字从后面往前复制到一个辅助数组中，确保 辅助数组（记为copy） 中的数字是递增排序的。在把较大的数字复制到辅助数组之后，把对应的指针向前移动一位，接下来进行下一轮比较。  


过程：先把数组分割成子数组，先统计出子数组内部的逆序对的数目，然后再统计出两个相邻子数组之间的逆序对的数目。在统计逆序对的过程中，还需要对数组进行排序。如果对排序算法很熟悉，我们不难发现这个过程实际上就是归并排序。


交换copy和data是因为：  
1.在每次的操作中，数值的比较都是采用当前传入函数中第一项，也就是data；比较的结果都存放到copy中；也就意味着此时copy中是经过此次调用的结果。  
2.从最底层返回时，进入了(start == end)的情形，data 和 copy 完全没有修改，此时copy和data还是一样的。  
3.进入倒数第二层时，程序进入上图26行以后部分，copy是部分排序后的新数组，data是旧数组。注意这里都是传值的调用，数组都是直接修改的。  
倒数第二层使用的copy其实是倒数第三层中的data,这就确保了倒数第三层进入26行以后时，数据比较使用的data是最新排序的数组。  
4.倒数第三层将排序的结果存入copy中。程序在倒数第四层进入26行后，使用的data数组为刚刚倒数第三层中的最新排序的copy.  
5.也就是说，在每次程序进入26行时，此时的data是最新的排序结果，copy是次新的结果。    
在最后一次进入26行以后时，copy为完整排序后的结果，data是次新的结果。  
然而这里第一个类内函数调用第二个函数时，data和copy的顺序没有改变，所以最后结果应该copy是完整排序的结果.data是差一步完成排序的结果。以输入[7,5,6,4], 最后的结果copy[4,5,6,7], data[5,7,4,6].

## 代码
```
class Solution {
public:
    int InversePairs(vector<int> data) 
    {
        if(data.empty()) return 0;
        vector<int> copy;
        for(int i = 0; i < data.size(); i++)
            copy.push_back(data[i]);
        int length = data.size();
        long long count = MergeSort(data, copy, 0, length - 1);
        return count % 1000000007;
    }
    long long MergeSort(vector<int>& data, vector<int>& copy, int start, int end)
    {
        if(start == end)
        {
            copy[start] = data[start];
            return 0; 
        }
        int mid = (end - start) / 2;
        long long left = MergeSort(copy, data, start, start + mid);
        long long right = MergeSort(copy, data, start + mid + 1, end);
        int left_point = start + mid;
        int right_point = end;
        int index_copy = end;
        long long count = 0;
        while(left_point >= start && right_point >= start + mid + 1)
        {
            if(data[left_point] > data[right_point])
            {
                count = count + (right_point - (start + mid + 1) + 1);
                copy[index_copy--] = data[left_point--];
            }
            else
            {
                copy[index_copy--] = data[right_point--];
            }
        }
        while(left_point >= start)
            copy[index_copy--] = data[left_point--];
        while(right_point >= start + mid + 1)
            copy[index_copy--] = data[right_point--];
        
        return count + left + right;
    }
};
```

## 36题目描述
两个链表的第一个公共结点  
输入两个链表，找出它们的第一个公共结点。（注意因为传入数据是链表，所以错误测试数据的提示是用其他方式显示的，保证传入数据是正确的）

## 思路
本题首先要明白，公共结点代表着，两个链表拥有公共尾部(因为只有一个next)。 所以先计算两者长度，然后让长的先走两个链表长度差后 再一起走，当相同时，就是第一个公共结点。

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
    ListNode* FindFirstCommonNode(ListNode* pHead1, ListNode* pHead2) 
    {
        if(pHead1 == NULL || pHead2 == NULL) return NULL;
        int pHead1_len = 0;
        int pHead2_len = 0;
        ListNode* p1 = pHead1;
        ListNode* p2 = pHead2;
        while(p1 != NULL)
        {
            pHead1_len++;
            p1 = p1 -> next;
        }
        while(p2 != NULL)
        {
            pHead2_len++;
            p2 = p2 -> next;
        }
        p1 = pHead1;
        p2 = pHead2;
        int difference = 0;
        if(pHead1_len > pHead2_len)
        {
            difference = pHead1_len - pHead2_len;
            while(difference)
            {
                p1 = p1 -> next;
                difference--;
            }
        }
        if(pHead2_len > pHead1_len)
        {
            difference = pHead2_len - pHead1_len;
            while(difference)
            {
                p2 = p2 -> next;
                difference--;
            }
        }
        while(p1 != NULL)
        {
            if(p1 == p2) return p1;
            else
            {
                p1 = p1 -> next;
                p2 = p2 -> next;
            }
        }
        return NULL;
    }
};
```

## 37题目描述
数字在排序数组中出现的次数  
统计一个数字在排序数组中出现的次数。

## 思路1
我所采用的二分查找变形。使用二分查找，找到k出现的最左位置，再向后遍历，如果重复则加一 不重复则break；  

## 代码
```
class Solution {
public:
    int GetNumberOfK(vector<int> data ,int k) 
    {
        if(data.empty()) return 0;
        int lower = get_lower(data, k);
        int count = 0;
        if(lower != -1)
        {
            while(lower <= data.size() - 1)
            {
                if(data[lower] == k) 
                {
                    count++;
                    lower++;
                    continue;
                }
                else break;
            }
        }
        return count;
    }
    int get_lower(vector<int> data, int k)
    {
        int start = 0;
        int end = data.size() - 1;
        int mid = (start + end) / 2;
        int lower = -1;
        while(start <= end)
        {
            if(k == data[start]) 
            {
                lower = start;
                break;
            }
            else if(k == data[mid]) 
            {
                lower = mid;
                end = mid - 1;
            }
            else if(k < data[mid]) end = mid - 1;
            else if(k > data[mid]) start = mid + 1;
            mid = (start + end) / 2;
        }
        return lower;
    }
};
```

## 思路2
由于数组有序，所以使用二分查找方法定位k的第一次出现位置和最后一次出现位置 (找到上界下界，此程序有bug，有特殊测试用例则无法通过 （还有一种情况不严谨，就是比如1，2，3，4，6，7寻找5，会返回6的下标但是此刻数组中不存在5）)

## 代码
```
链接：https://www.nowcoder.com/questionTerminal/70610bf967994b22bb1c26f9ae901fa2
来源：牛客网

class Solution {
public:
    int GetNumberOfK(vector<int> data ,int k) {
        int lower = getLower(data,k);
        int upper = getUpper(data,k);
         
        return upper - lower + 1;
    }
     
    //获取k第一次出现的下标
    int getLower(vector<int> data,int k){
        int start = 0,end = data.size()-1;
        int mid = (start + end)/2;
         
        while(start <= end){
            if(data[mid] < k){
                start = mid + 1;
            }else{
                end = mid - 1;
            }
            mid = (start + end)/2;
        }
        return start;
    }
    //获取k最后一次出现的下标
    int getUpper(vector<int> data,int k){
         int start = 0,end = data.size()-1;
        int mid = (start + end)/2;
         
        while(start <= end){
            if(data[mid] <= k){
                start = mid + 1;
            }else{
                end = mid - 1;
            }
            mid = (start + end)/2;
        }
         
        return end;
    }
};
```

## 38题目描述
二叉树的深度  
输入一棵二叉树，求该树的深度。从根结点到叶结点依次经过的结点（含根、叶结点）形成树的一条路径，最长路径的长度为树的深度。
## 思路1
使用递归，左子树深度大则返回左子树深度，反之返回右子树

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
    int TreeDepth(TreeNode* pRoot)
    {
        if(pRoot == NULL) return 0;
        int depth = 0;
        depth = count(pRoot, depth);
        return depth;
    }
    
    int count(TreeNode* p, int depth)
    {
        depth++;
        int left_depth = depth;
        int right_depth = depth;
        if(p -> left != NULL)
            left_depth = count(p -> left, depth);
        if(p -> right != NULL)
            right_depth = count(p -> right, depth);
        return max(left_depth, right_depth);
    }
};
```

## 思路2
使用队列，进行层次遍历

## 代码
```
class Solution {
public:
    int TreeDepth(TreeNode* pRoot) {
        if (!pRoot) return 0;
        queue<TreeNode*> que;
        que.push(pRoot);int depth=0;
        while (!que.empty()) {
            int size=que.size();
            depth++;
            for (int i=0;i<size;i++) {      //一次处理一层的数据
                TreeNode *node=que.front();
                que.pop();
                if (node->left) que.push(node->left);
                if (node->right) que.push(node->right);
            }
        }
        return depth;
    }
};
```

## 39题目描述
平衡二叉树  
输入一棵二叉树，判断该二叉树是否是平衡二叉树。

## 思路
使用递归，这里要注意平衡二叉树的定义，一个平衡二叉树中每一个单独的子树也是一个平衡二叉树。平衡二叉树：左子树右子树深度之差不超过1。  
使用了两个递归，一个是判断当前子树左右深度是否超过1(是否是平衡二叉树)， 另一个是计算深度。 如果其中一个子树不是平衡二叉树，则直接返回否。

## 代码
```
class Solution {
public:
    bool IsBalanced_Solution(TreeNode* pRoot) 
    {
        if(pRoot == NULL) return 1;
        return IsBalanced(pRoot, 1);
    }
    
    bool IsBalanced(TreeNode* pRoot, bool is)
    {
        if(is == false) return false;
        int right_depth = 0;
        int left_depth = 0;
        bool right_is = 1;
        bool left_is = 1;
        if(pRoot -> left != NULL)
        {
            left_depth = CountDepth(pRoot -> left, left_depth);
            left_is = IsBalanced(pRoot -> left, 1);
        }
        if(pRoot -> right != NULL)
        {
            right_depth = CountDepth(pRoot -> right, right_depth);
            right_is = IsBalanced(pRoot -> right, 1);
        }
        if(abs(right_depth - left_depth) > 1) is = 0;
        return is && right_is && left_is;
    }
    
    int CountDepth(TreeNode* pRoot, int depth)
    {
        depth++;
        int left_depth = depth;
        int right_depth = depth;
        if(pRoot -> left != NULL)
            left_depth = CountDepth(pRoot -> left, left_depth);
        if(pRoot -> right != NULL)
            right_depth = CountDepth(pRoot -> right, right_depth);
        return max(left_depth, right_depth);
    }
};
```

## 40题目描述
数组中只出现一次的数字  
一个整型数组里除了两个数字之外，其他的数字都出现了两次。请写程序找出这两个只出现一次的数字。

## 思路
首先我们考虑这个问题的一个简单版本：一个数组里除了一个数字之外，其他的数字都出现了两次。请写程序找出这个只出现一次的数字。  
 这个题目的突破口在哪里？题目为什么要强调有一个数字出现一次，其他的出现两次？我们想到了异或运算的性质：任何一个数字异或它自己都等于0 。也就是说，如果我们从头到尾依次异或数组中的每一个数字，那么最终的结果刚好是那个只出现一次的数字，因为那些出现两次的数字全部在异或中抵消掉了。  
 有了上面简单问题的解决方案之后，我们回到原始的问题。如果能够把原数组分为两个子数组。在每个子数组中，包含一个只出现一次的数字，而其它数字都出现两次。如果能够这样拆分原数组，按照前面的办法就是分别求出这两个只出现一次的数字了。  
 我们还是从头到尾依次异或数组中的每一个数字，那么最终得到的结果就是两个只出现一次的数字的异或结果。因为其它数字都出现了两次，在异或中全部抵消掉了。由于这两个数字肯定不一样，那么这个异或结果肯定不为0 ，也就是说在这个结果数字的二进制表示中至少就有一位为1 。我们在结果数字中找到第一个为1 的位的位置，记为第N 位。现在我们以第N 位是不是1 为标准把原数组中的数字分成两个子数组，第一个子数组中每个数字的第N 位都为1 ，而第二个子数组的每个数字的第N 位都为0 。  
 现在我们已经把原数组分成了两个子数组，每个子数组都包含一个只出现一次的数字，而其它数字都出现了两次。因此到此为止，所有的问题我们都已经解决。
 
## 代码
```
class Solution {
public:
    void FindNumsAppearOnce(vector<int> data,int* num1,int *num2) 
    {
        if(data.size() < 2) return ;
        int temp = data[0];
        for(int i = 1; i < data.size(); i++)
            temp ^= data[i];
        if(temp == 0) return ;
        int index = 0;
        while((temp & 1) == 0)
        {
            temp = temp >> 1;
            index++;
        }
        *num1 = 0;
        *num2 = 0;
        for(int i = 0; i < data.size(); i++)
        {
            if(IsBit(data[i], index))
                *num1 ^= data[i];
            else
                *num2 ^= data[i];
        }
    }
    
    bool IsBit(int i, int index)
    {
        i = i >> index;
        return (i & 1);
    }
};
```