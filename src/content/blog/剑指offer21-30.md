---
title: "剑指offer21-30"
description: "剑指offer"
date: "2020-03-31"
tags: ["Problems"]
draft: false
featured: false
readingTime: 6
---
## 21题目描述
栈的压入、弹出序列：

输入两个整数序列，第一个序列表示栈的压入顺序，请判断第二个序列是否可能为该栈的弹出顺序。假设压入栈的所有数字均不相等。例如序列1,2,3,4,5是某栈的压入顺序，序列4,5,3,2,1是该压栈序列对应的一个弹出序列，但4,3,5,1,2就不可能是该压栈序列的弹出序列。（注意：这两个序列的长度是相等的）

## 思路
我想的思路是借用一个辅助栈，进行真实的入栈出栈，判断第二个序列与栈顶是否相同，如果不相同，则进行序列1的压入栈。在压入是判断压入的是否与序列2当前元素相等，如果相等，则视为直接出栈，然后返回来判断序列2的下一个元素是否与栈顶相等，相等的话则pop，序列2继续往后走，以此循环。最后判断辅助栈是否为空，如果为空，则出栈顺序没毛病，返回1，如果不为空，则出栈不符合规则，返回0；

## 代码
```
class Solution {
public:
    bool IsPopOrder(vector<int> pushV,vector<int> popV) 
    {
        stack<int> aux;
        if(pushV.size() != popV.size()) return false;
        if(pushV.empty() || popV.empty()) return false;
        int i = 0, j = 0;

        for(; i < pushV.size() && j < popV.size();)
        {
            if(aux.empty())
            {
                aux.push(pushV[i]);
                i++;
                continue;
            }
            if(aux.top() != popV[j])
            {
                for(; i < pushV.size(); )
                {
                    if(pushV[i] != popV[j])
                    {
                        aux.push(pushV[i]);
                        i++;
                    }
                    if(pushV[i] == popV[j])
                    {
                        i++;
                        j++;
                        break;
                    }
                }
                continue;
            }
            if(aux.top() == popV[j])
            {
                aux.pop();
                j++;
            }
        }
        for(; j < popV.size();)
        {
            if(aux.top() == popV[j])
            {
                aux.pop();
                j++;
            }
            else break;
        }

        return aux.empty();
    }
};
```

## 22题目描述
从上往下打印二叉树：

本题知识点：队列，树

从上往下打印出二叉树的每个节点，同层节点从左至右打印。

## 思路
其实比较简单的一个题，我的思路陷入到递归里面去了，，但其实不用，使用一个队列就可以简单解决问题。 用一个队列，可以按从左到右压入树的一层，这样就实现了题目所要求的目的。

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
    vector<int> PrintFromTopToBottom(TreeNode* root) 
    {
        vector<int> P;
        queue<TreeNode*> aux;
        if(root == NULL) return P;
        aux.push(root);
        while(!aux.empty())
        {
            P.push_back(aux.front() -> val);
            if(aux.front() -> left != NULL)
                aux.push(aux.front() -> left);
            if(aux.front() -> right != NULL)
                aux.push(aux.front() -> right);
            aux.pop();
        }
        return P;
    }
};
```

## 23题目描述
二叉搜索树的后序遍历序列：

本题知识点：栈，树

输入一个整数数组，判断该数组是不是某二叉搜索树的后序遍历的结果。如果是则输出Yes,否则输出No。假设输入的数组的任意两个数字都互不相同。

## 思路
BST的后序序列的合法序列是，对于一个序列S，最后一个元素是x （也就是根），如果去掉最后一个元素的序列为T，那么T满足：T可以分成两段，前一段（左子树）小于x，后一段（右子树）大于x，且这两段（子树）都是合法的后序序列。完美的递归定义 : ) 。 此时要注意要想到判断非法的条件是什么，就是后半段中有元素小于根节点。

## 代码
```
class Solution {
public:
    bool Verify(vector<int> sequence, int left, int right)
    {
        if(left >= right) return true;
        int new_left = left;
        while(new_left < right && sequence[new_left] < sequence[right]) new_left++;
        for(int i = new_left + 1; i < right; i++)
            if(sequence[i] < sequence[right])
                return false;
        return Verify(sequence, left, new_left - 1) && Verify(sequence, new_left, right - 1);
    }
    
    bool VerifySquenceOfBST(vector<int> sequence) 
    {
        if(sequence.empty()) return false;
        return Verify(sequence, 0, sequence.size() - 1);
    }
};
```

## 24题目描述
二叉树中和为某一值的路径：

本题知识点：树

输入一颗二叉树的根节点和一个整数，打印出二叉树中结点值的和为输入整数的所有路径。路径定义为从树的根结点开始往下一直到叶结点所经过的结点形成一条路径。(注意: 在返回值的list中，数组长度大的数组靠前)

## 思路
采用递归的思路，这里主要熟悉，全局变量在递归中的应用，和STL 插入的方法。设置一个暂时数组与要存放的二维数组。采用递归一直到叶子节点，如果不符合，不要忘记在暂时数组中pop出存放的节点。有点类似于DFS的思路。注意题目要求返回的list数组长度大的在前面，所以在加入到二维数组中时要加一个判断，判断数组list的长短，长的放前面。

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
    vector<vector<int>> paths;
    vector<int> temp;
    vector<vector<int>> FindPath(TreeNode* root,int expectNumber) 
    {
        if(root == NULL || expectNumber < root -> val) return paths;
        temp.push_back(root -> val);
        if(root -> val == expectNumber && root -> left == NULL && root -> right == NULL)
        {
            if(paths.size() == 0) paths.push_back(temp);
            else
            {
                for(int i = 0; i < paths.size(); i++)
                {
                    if(temp.size() > paths[i].size())
                    {
                        paths.insert(paths.begin() + i, temp);
                        break;
                    }
                    else if(i == paths.size() - 1)
                    {
                        paths.push_back(temp);
                    }
                }
            }
        }
        FindPath(root -> right, expectNumber - root -> val);
        FindPath(root -> left, expectNumber - root -> val);
        temp.pop_back();
        return paths;
    }
};
```

## 25题目描述
复杂链表的复制：

本题知识点：链表

输入一个复杂链表（每个节点中有节点值，以及两个指针，一个指向下一个节点，另一个特殊指针指向任意一个节点），返回结果为复制后复杂链表的head。（注意，输出结果中请不要返回参数中的节点引用，否则判题程序会直接返回空）

## 思路
1、复制每个节点，如：复制节点A得到A1，将A1插入节点A后面  
2、遍历链表，A1->random = A->random->next;  
3、将链表拆分成原链表和复制后的链表

## 代码
```
/*
struct RandomListNode {
    int label;
    struct RandomListNode *next, *random;
    RandomListNode(int x) :
            label(x), next(NULL), random(NULL) {
    }
};
*/
class Solution {
public:
    RandomListNode* Clone(RandomListNode* pHead)
    {
        if(pHead == NULL) return NULL;
        RandomListNode* head = pHead;
        while(head != NULL)
        {
            RandomListNode* new_node = new RandomListNode(head -> label);
            new_node -> next = head -> next;
            head -> next = new_node;
            head = new_node -> next;
        }
        head = pHead;
        while(head != NULL)
        {
            if(head -> random != NULL)
                head -> next -> random = head -> random -> next;
            head = head -> next;
            head = head -> next;
        }
        RandomListNode* first_head = pHead;
        RandomListNode* second_head;
        RandomListNode* new_head = pHead -> next;
        while(first_head -> next != NULL)
        {
            second_head = first_head -> next;
            first_head -> next = second_head -> next;
            first_head = second_head;
        }
        return new_head;
    }
};
```

## 26题目描述：
二叉搜索树与双向链表：  
本题知识点：链表、树  
输入一棵二叉搜索树，将该二叉搜索树转换成一个排序的双向链表。要求不能创建任何新的结点，只能调整树中结点指针的指向。

## 思路
本题要明白一个规律：二叉搜索树的中序遍历就是从小到大，换句话说，要想从小到大遍历二叉搜索树，需要使用中序遍历。 那么使用中序遍历进行递归，进行指针的变换即可。其中的一个重要细节要注意：pre指针一定要进行引用，因为pre是一个动态的，pre的改变要返回去给前一次调用，不加引用调用结束pre没有变化，一直为空。

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
    TreeNode* Convert(TreeNode* pRootOfTree)
    {
        if(pRootOfTree == NULL) return NULL;
        TreeNode* pre = NULL;
        Helper(pRootOfTree, pre);
        TreeNode* new_root = pRootOfTree;
        while(new_root -> left != NULL)
            new_root = new_root -> left;
        return new_root;
    }
    
    void Helper(TreeNode* cur, TreeNode*& pre)
    {
        if(cur == NULL) return;
        Helper(cur -> left, pre);
        cur -> left = pre;
        if(pre) pre -> right = cur;
        pre = cur;
        Helper(cur -> right, pre);
    }
};
```


## 27题目描述
字符串的排列：  
本题知识点：字符串 动态规划 递归  
输入一个字符串,按字典序打印出该字符串中字符的所有排列。例如输入字符串abc,则打印出由字符a,b,c所能排列出来的所有字符串abc,acb,bac,bca,cab和cba。  
输入描述： 输入一个字符串,长度不超过9(可能有字符重复),字符只包括大小写字母。

## 思路
思路：递归法，问题转换为先固定第一个字符，求剩余字符的排列；求剩余字符排列时跟原问题一样。  
(1) 遍历出所有可能出现在第一个位置的字符（即：依次将第一个字符同后面所有字符交换）；  
(2) 固定第一个字符，求后面字符的排列（即：在第1步的遍历过程中，插入递归进行实现）。
需要注意的几点：  
a. 先确定递归结束的条件，例如本题中可设begin == str.size() - 1;   
b. 形如 aba 或 aa 等特殊测试用例的情况，vector在进行push_back时是不考虑重复情况的，需要自行控制；  
c. 输出的排列可能不是按字典顺序排列的，可能导致无法完全通过测试用例，考虑输出前排序，或者递归之后取消复位操作。

此题要注意的点：  
1.关于vector的进一步熟练使用，如find() sort()函数的使用
2.要想明白递归结束的条件，这是前提
3.特殊测试用例aba,aa等 用比较简单的find函数就能实现，这还是表明了要多掌握直接可用的函数。

## 代码
```
class Solution {
public:
    vector<string> Permutation(string str) 
    {
        vector<string> print_list;
        if(str.empty()) return print_list;
        
        Permulation(str, print_list, 0);
        
        sort(print_list.begin(), print_list.end());
        return print_list;
    }
    
    void Permulation(string str, vector<string> &print_list, int begin)
    {
        if(begin == str.size() - 1)
        {
            if(find(print_list.begin(), print_list.end(), str) == print_list.end())
                print_list.push_back(str);
        }
        else
        {
            for(int i = begin; i < str.size(); i++)
            {
                swap(str[begin], str[i]);
                Permulation(str, print_list, begin + 1);
                swap(str[begin], str[i]);
            }
        }
    }
    
    void swap(char &a, char &b)
    {
        char temp = a;
        a = b;
        b = temp;
    }
};
```

## 28题目描述
数组中出现次数超过一半的数字  
本题知识点：数组  
数组中有一个数字出现的次数超过数组长度的一半，请找出这个数字。例如输入一个长度为9的数组{1,2,3,2,2,2,5,4,2}。由于数字2在数组中出现了5次，超过数组长度的一半，因此输出2。如果不存在则输出0。

## 思路
思路1：  
我想的思路属于最naive的那种，，建立一个容量为10的数组，每个元素代表0-9出现的次数，遍历目标数组，出现一次则代表元素+1， 最后看哪个次数超过目标数组size/2。  
思路2：  
数组排序后，如果符合条件的数存在则一定是数组中间那个数。时间复杂度为O(NlogN)。  
思路3(我觉的不错的一个思路)：  
如果有符合条件的数字，则它出现的次数比其他所有数字出现的次数和还要多。
在遍历数组时保存两个值：一是数组中一个数字，一是次数。遍历下一个数字时，若它与之前保存的数字相同，则次数加1，否则次数减1；若次数为0，则保存下一个数字，并将次数置为1。遍历结束后，所保存的数字即为所求。然后再判断它是否符合条件即可。

## 代码
```
class Solution {
public:
    int MoreThanHalfNum_Solution(vector<int> numbers) 
    {
        vector<int> count(10);
        for(int i = 0; i < 10; i++)
            count[i] = 0;
        int print = 0;
        if(numbers.empty()) return print;
        for(int i = 0; i < numbers.size(); i++)
            count[numbers[i]]++;
        for(int i = 0; i < count.size(); i++)
            if(count[i] > (numbers.size() / 2)) print = i;
        return print;
    }
};
```

## 29题目描述
最小的K个数  
本题知识点：数组 高级算法  
输入n个整数，找出其中最小的K个数。例如输入4,5,1,6,2,7,3,8这8个数字，则最小的4个数字是1,2,3,4,。

## 思路
本题我还是采用辅助数组，记录从0-10 是否出现过，然后从小到大把出现过的赋予到返回数组中。 本题一开始一直ac不了，后来才发现是因为没有考虑特殊情况。也就是k大于原始数组长度或者k大于10。所以还是一定要考虑周全特殊情况。

## 代码
```
class Solution {
public:
    vector<int> GetLeastNumbers_Solution(vector<int> input, int k) 
    {
        vector<int> count(10);
        for(int i = 0; i < 10; i++) count[i] = 0;
        vector<int> min_numbers;
        if(input.empty() || k > input.size() || k > 10) return min_numbers;
        for(int i = 0; i < input.size(); i++)
            if(count[input[i]] == 0) count[input[i]] = 1;

        for(int i = 0, num = 0; i < 10 && num < k; i++)
        {
            if(count[i])
            {
                min_numbers.push_back(i);
                num++;
            }
        }
        return min_numbers;
    }
};
```

## 30题目描述
连续子数组的最大和  
本题知识点：数组  
HZ偶尔会拿些专业问题来忽悠那些非计算机专业的同学。今天测试组开完会后,他又发话了:在古老的一维模式识别中,常常需要计算连续子向量的最大和,当向量全为正数的时候,问题很好解决。但是,如果向量中包含负数,是否应该包含某个负数,并期望旁边的正数会弥补它呢？例如:{6,-3,-2,7,-15,1,2,2},连续子向量的最大和为8(从第0个开始,到第3个为止)。给一个数组，返回它的最大连续子序列的和，你会不会被他忽悠住？(子向量的长度至少是1)

## 思路
设置两个变量，分别存储当前最大和以及目前的和。进行循环，计算和，如果比最大和大则存储，如果小于0则置0；

## 代码
```
class Solution {
public:
    int FindGreatestSumOfSubArray(vector<int> array) 
    {
        int tempsum = 0;
        int result = array[0];
        if(array.empty()) return 0;
        for(int i = 0; i < array.size(); i++)
        {
            tempsum = tempsum + array[i];
            if(tempsum > 0)
            {
                if(tempsum > result)
                    result = tempsum;
            }
            if(tempsum <= 0)
            {
                if(tempsum > result) result = tempsum;
                tempsum = 0;
            }
        }
        return result;
    }
};
```
