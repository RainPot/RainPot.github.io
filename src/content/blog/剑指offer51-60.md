---
title: "剑指offer51-60"
description: "剑指offer"
date: "2020-04-16"
tags: ["Problems"]
draft: false
featured: false
readingTime: 6
---
## 51题目描述
构建乘积数组  
给定一个数组A[0,1,...,n-1],请构建一个数组B[0,1,...,n-1],其中B中的元素B[i]=A[0]*A[1]*...*A[i-1]*A[i+1]*...*A[n-1]。不能使用除法。（注意：规定B[0] = A[1] * A[2] * ... * A[n-1]，B[n-1] = A[0] * A[1] * ... * A[n-2];）

## 思路1
直接暴力两个循环。。

## 代码
```
class Solution {
public:
    vector<int> multiply(const vector<int>& A) 
    {
        vector<int> result;
        int temp = 1;
        if(A.size() == 0) return result;
        for(int i = 0; i < A.size(); i++)
        {
            temp = 1;
            for(int j = 0; j < A.size(); j++)
            {
                if(j == i) continue;
                else
                {
                    temp *= A[j];
                }
            }
            result.push_back(temp);
        }
        return result;
    }
};
```

## 思路2
//B[i]=A[0]*A[1]*...*A[i-1]*A[i+1]*...*A[n-1]  
//从左到右算 B[i]=A[0]*A[1]*...*A[i-1]  
//从右到左算B[i]*=A[i+1]*...*A[n-1]  

## 代码
```
class Solution {
public:
    vector<int> multiply(const vector<int>& A) {
     
        int n=A.size();
        vector<int> b(n);
        int ret=1;
        for(int i=0;i<n;ret*=A[i++]){
            b[i]=ret;
        }
        ret=1;
        for(int i=n-1;i>=0;ret*=A[i--]){
            b[i]*=ret;
        }
        return b;
    }
};
```

## 52题目描述
正则表达式匹配  
请实现一个函数用来匹配包括'.'和'*'的正则表达式。模式中的字符'.'表示任意一个字符，而'*'表示它前面的字符可以出现任意次（包含0次）。 在本题中，匹配是指字符串的所有字符匹配整个模式。例如，字符串"aaa"与模式"a.a"和"ab*ac*a"匹配，但是与"aa.a"和"ab*a"均不匹配  

## 思路
使用递归
```
    首先，考虑特殊情况：
         1>两个字符串都为空，返回true
         2>当第一个字符串不空，而第二个字符串空了，返回false（因为这样，就无法
            匹配成功了,而如果第一个字符串空了，第二个字符串非空，还是可能匹配成
            功的，比如第二个字符串是“a*a*a*a*”,由于‘*’之前的元素可以出现0次，
            所以有可能匹配成功）
    之后就开始匹配第一个字符，这里有两种可能：匹配成功或匹配失败。但考虑到pattern
    下一个字符可能是‘*’， 这里我们分两种情况讨论：pattern下一个字符为‘*’或
    不为‘*’：
          1>pattern下一个字符不为‘*’：这种情况比较简单，直接匹配当前字符。如果
            匹配成功，继续匹配下一个；如果匹配失败，直接返回false。注意这里的
            “匹配成功”，除了两个字符相同的情况外，还有一种情况，就是pattern的
            当前字符为‘.’,同时str的当前字符不为‘\0’。
          2>pattern下一个字符为‘*’时，稍微复杂一些，因为‘*’可以代表0个或多个。
            这里把这些情况都考虑到：
               a>当‘*’匹配0个字符时，str当前字符不变，pattern当前字符后移两位，
                跳过这个‘*’符号；
               b>当‘*’匹配1个或多个时，str当前字符移向下一个，pattern当前字符
                不变。（这里匹配1个或多个可以看成一种情况，因为：当匹配一个时，
                由于str移到了下一个字符，而pattern字符不变，就回到了上边的情况a；
                当匹配多于一个字符时，相当于从str的下一个字符继续开始匹配）
    之后再写代码就很简单了。
```
## 代码
```
class Solution {
public:
    bool match(char* str, char* pattern)
    {
        if(*str == '\0' && *pattern == '\0') return true;
        if(*str != '\0' && *pattern == '\0') return false;
        if(*(pattern + 1) != '*')
        {
            if((*pattern == *str) || (*str != '\0' && *pattern == '.'))
                return match(str + 1, pattern + 1);
            else
                return false;
        }
        else
        {
            if((*pattern == *str) || (*str != '\0' && *pattern == '.'))
                return match(str + 1, pattern) || match(str, pattern + 2);
            else
                return match(str, pattern + 2);
        }
    }
};
```

## 53题目描述
表示数值的字符串  
请实现一个函数用来判断字符串是否表示数值（包括整数和小数）。例如，字符串"+100","5e2","-123","3.1416"和"-1E-16"都表示数值。 但是"12e","1a3.14","1.2.3","+-5"和"12e+4.3"都不是。  
## 思路
依旧是各路判断，判断条件见注释。

## 代码
```
class Solution {
public:
    bool isNumeric(char* string)
    {
        if(*string == '\0') return false;
        bool symbol = false, demical = false, hasE = false;
        for(int i = 0; i < strlen(string); i++)
        {
            if(string[i] == 'e' || string[i] == 'E')
            {
                if(hasE) return false; //E后面不能再有E
                if(i == (strlen(string) - 1)) return false; //E不能在数值末尾
                hasE = true;
                continue;
            }
            else if(string[i] == '+' || string[i] == '-')
            {
                if(symbol && string[i - 1] != 'E' && string[i - 1] != 'e') return false; //符号出现第二次必须在E或e后面
                if(!symbol && i > 0 && string[i - 1] != 'e' && string[i - 1] != 'E') return false; //符号出现第一次符号且不在开头的话 同样也需要在E或e后面
                symbol = true;
                continue;
            }
            else if(string[i] == '.')
            {
                if(hasE || demical) return false; //.不能出现两次或E的后面 这里一个疑问是.为什么能在开头
                demical = true;
                continue;
            }
            else if(string[i] < '0' || string[i] > '9') return false;
        }
        return true;
    }

};
```

## 54题目描述
字符流中第一个不重复的字符  
请实现一个函数用来找出字符流中第一个只出现一次的字符。例如，当从字符流中只读出前两个字符"go"时，第一个只出现一次的字符是"g"。当从该字符流中读出前六个字符“google"时，第一个只出现一次的字符是"l"。  

## 思路
建立一个256大小的数组用来记录256个字符出现的次数，然后直接在里面寻找出现一次的就行了。重点在于知道256字符。

## 代码
```
class Solution
{
public:
    int count[256] = {0};
    string s;
  //Insert one char from stringstream
    void Insert(char ch)
    {
        s += ch;
        count[int(ch)]++;
    }
  //return the first appearence once char in current stringstream
    char FirstAppearingOnce()
    {
        char result = '#';
        for(int i = 0; i < s.size(); i++)
        {
            if(count[int(s[i])] == 1)
            {
                result = s[i];
                break;
            }
        }
        return result;
    }

};
```

## 55题目描述
链表中环的入口结点  
给一个链表，若其中包含环，请找出该链表的环的入口结点，否则，输出null。  

## 思路1
设置快慢指针，都从链表头出发，快指针每次走两步，慢指针一次走一步，假如有环，一定相遇于环中某点(结论1)。接着让两个指针分别从相遇点和链表头出发，两者都改为每次走一步，最终相遇于环入口(结论2)。以下是两个结论证明：  
两个结论：  
1、设置快慢指针，假如有环，他们最后一定相遇。  
2、两个指针分别从链表头和相遇点继续出发，每次走一步，最后一定相遇与环入口。  
证明结论1：设置快慢指针fast和low，fast每次走两步，low每次走一步。假如有环，两者一定会相遇（因为low一旦进环，可看作fast在后面追赶low的过程，每次两者都接近一步，最后一定能追上）。  
证明结论2：  
设：  
链表头到环入口长度为--a  
环入口到相遇点长度为--b  
相遇点到环入口长度为--c  
则：相遇时  
快指针路程=a+(b+c)k+b ，k>=1  其中b+c为环的长度，k为绕环的圈数（k>=1,即最少一圈，不能是0圈，不然和慢指针走的一样长，矛盾）。  
慢指针路程=a+b  
快指针走的路程是慢指针的两倍，所以：  
（a+b）*2=a+(b+c)k+b  
化简可得：  
a=(k-1)(b+c)+c 这个式子的意思是： 链表头到环入口的距离=相遇点到环入口的距离+（k-1）圈环长度。其中k>=1,所以k-1>=0圈。所以两个指针分别从链表头和相遇点出发，最后一定相遇于环入口。  

## 代码
```
/*
struct ListNode {
    int val;
    struct ListNode *next;
    ListNode(int x) :
        val(x), next(NULL) {
    }
};
*/
class Solution {
public:
    ListNode* EntryNodeOfLoop(ListNode* pHead)
    {
        if(pHead == NULL) return NULL;
        ListNode* fast = pHead;
        ListNode* slow = pHead;
        while(fast && fast -> next)
        {
            fast = fast -> next -> next;
            slow = slow -> next;
            if(fast == slow) break;
        }
        if(fast == NULL || fast -> next == NULL) return NULL;
        slow = pHead;
        while(slow != fast)
        {
            fast = fast -> next;
            slow = slow -> next;
        }
        return slow;
    }
};
```

## 思路2
这个思路要比1好推断出来。  
首先先计算环中结点个数。计算方法：（设置快慢两个指针，如果有环，则两者一定会相遇且相遇在环中）。从相遇点转一圈找到环的个数。  
然后再设置两个快慢指针，快的先走环个数步，然后两者一起往后走 当两者相遇时，就是入口。

## 代码
```
/*
struct ListNode {
    int val;
    struct ListNode *next;
    ListNode(int x) :
        val(x), next(NULL) {
    }
};
*/
class Solution {
public:
    ListNode* EntryNodeOfLoop(ListNode* pHead)
    {
         if(pHead==NULL)return NULL;
         //先计算环中结点的个数
         //快慢指针相遇结点一定在环中
         ListNode *pFast=pHead,*pSlow=pHead->next;
         while(pFast!=NULL&&pSlow!=NULL&&pFast!=pSlow){
            pSlow=pSlow->next;
            pFast=pFast->next;
            if(pFast!=NULL)
                pFast=pFast->next;
         }
         //开始统计环结点数
         int countNum=1;
         ListNode *pTempNode=pFast->next;
         if(pFast==pSlow&&pFast!=NULL){
             while(pTempNode!=pFast){
                 pTempNode=pTempNode->next;
                 ++countNum;
             }
         }
         else
             return NULL;
         //再设两指针，一先一后
         ListNode *pNode1=pHead,*pNode2=pHead;
         for(int i=0;i<countNum;i++){
                pNode1=pNode1->next;
         }
         while(pNode1!=pNode2){
             pNode1=pNode1->next;
             pNode2=pNode2->next;
         }
         return pNode1;
          
    }
};
```

## 56题目描述
删除链表中重复的结点  
在一个排序的链表中，存在重复的结点，请删除该链表中重复的结点，重复的结点不保留，返回链表头指针。 例如，链表1->2->3->3->4->4->5 处理后为 1->2->5

## 思路
见注释  

## 代码
```
/*
struct ListNode {
    int val;
    struct ListNode *next;
    ListNode(int x) :
        val(x), next(NULL) {
    }
};
*/
class Solution {
public:
    ListNode* deleteDuplication(ListNode* pHead)
    {
        if( pHead == NULL ) return pHead;
 
        ListNode *pre = NULL; //指向前面最晚访问过的不重复结点
        ListNode *p = pHead; //指向当前处理的结点
        ListNode *q = NULL; //指向当前处理结点后面结点
 
        while( p != NULL )
        {
            //当前结点p，（其实是p指向当前结点），与它下一个结点p->next的val相同，说明要删掉有这个val的所有结点
            if( p->next != NULL && p->next->val == p->val )
            {
                q = p->next;
 
                //找到q，它指向最后一个与p val相同的结点，那p 到 q （包含） 都是要删除的
                while( q != NULL && q->next != NULL && q->next->val == p->val )
                {
                    q = q->next;
                }
     
                //如果p指向链表中第一个元素，p -> ... -> q ->... , 要删除p到q, 将指向链表第一个元素的指针pHead指向q->next。
                if( p == pHead )
                {
                    pHead = q->next;
                }
                else//如果p不指向链表中第一个元素，pre -> p ->...->q ->... ，要删除p到q，即pre->next = q->next
                {
                    pre->next = q->next;
                }
                //当前处理的p要向链表尾部移动
                p = q->next;
            }
            else
            {
                pre = p;
                p = p->next;
            }
        }
        return pHead;
    }
};
```

## 57题目描述
二叉树的下一个结点  
给定一个二叉树和其中的一个结点，请找出中序遍历顺序的下一个结点并且返回。注意，树中的结点不仅包含左右子结点，同时包含指向父结点的指针。

## 思路
分析二叉树的下一个节点，一共有以下情况：  
1.二叉树为空，则返回空；  
2.节点右孩子存在，则设置一个指针从该节点的右孩子出发，一直沿着指向左子结点的指针找到的叶子节点即为下一个节点；  
3.节点不是根节点。如果该节点是其父节点的左孩子，则返回父节点；否则继续向上遍历其父节点的父节点，重复之前的判断，返回结果。  

## 代码
```
/*
struct TreeLinkNode {
    int val;
    struct TreeLinkNode *left;
    struct TreeLinkNode *right;
    struct TreeLinkNode *next;
    TreeLinkNode(int x) :val(x), left(NULL), right(NULL), next(NULL) {
        
    }
};
*/
class Solution {
public:
    TreeLinkNode* GetNext(TreeLinkNode* pNode)
    {
        if(pNode == NULL) return NULL;
        if(pNode -> right)
        {
            pNode = pNode -> right;
            while(pNode -> left)
                pNode = pNode -> left;
            return pNode;
        }
        while(pNode -> next != NULL)
        {
            TreeLinkNode *proot=pNode->next;
            if(proot->left==pNode)
                return proot;
            pNode=pNode->next;
        }
        return NULL;
    }
};
```

## 58题目描述
对称的二叉树  
请实现一个函数，用来判断一颗二叉树是不是对称的。注意，如果一个二叉树同此二叉树的镜像是同样的，定义其为对称的。  

## 思路
采用递归  

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
    bool isSymmetrical(TreeNode* pRoot)
    {
        return IS(pRoot, pRoot);
    }
    
    bool IS(TreeNode* pRoot1, TreeNode* pRoot2)
    {
        if(pRoot1 == NULL && pRoot2 == NULL) return true;
        if(pRoot1 == NULL || pRoot2 == NULL) return false;
        if(pRoot1 -> val != pRoot2 -> val) return false;
        return IS(pRoot1 -> left, pRoot2 -> right) && IS(pRoot1 -> right, pRoot2 -> left);
    }

};
```

## 59题目描述
按之字形顺序打印二叉树  
请实现一个函数按照之字形打印二叉树，即第一行按照从左到右的顺序打印，第二层按照从右至左的顺序打印，第三行按照从左到右的顺序打印，其他行以此类推。  

## 思路
采用两个栈来存取所读节点，因为栈的输出是倒序，正好符合之字型输出。  

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
    vector<vector<int> > Print(TreeNode* pRoot) 
    {
        vector<vector<int>> result;
        if(pRoot == NULL) return result;
        stack<TreeNode*> stackR;
        stack<TreeNode*> stackL;
        stackL.push(pRoot);
        vector<int> temp;
        temp.push_back(pRoot -> val);
        result.push_back(temp);
        temp.clear();
        while(!stackL.empty() || !stackR.empty())
        {
            while(!stackL.empty())
            {
                TreeNode* L = stackL.top();
                stackL.pop();
                if(L -> right)
                {
                    stackR.push(L -> right);
                    temp.push_back(L -> right -> val);
                }
                if(L -> left)
                {
                    stackR.push(L -> left);
                    temp.push_back(L -> left -> val);
                }
            }
            if(!temp.empty())
            {
                result.push_back(temp);
                temp.clear();
            }
            while(!stackR.empty())
            {
                TreeNode* R = stackR.top();
                stackR.pop();
                if(R -> left)
                {
                    stackL.push(R -> left);
                    temp.push_back(R -> left -> val);
                }
                if(R -> right)
                {
                    stackL.push(R -> right);
                    temp.push_back(R -> right -> val);
                }
            }
            if(!temp.empty())
            {
                result.push_back(temp);
                temp.clear();
            }
        }
        return result;
    }
    
};
```

## 60题目描述
把二叉树打印成多行  
从上到下按层打印二叉树，同一层结点从左至右输出。每一层输出一行。

## 思路
与上一题思路一样，只不过输出顺序变为从左至右 也就是不许转换顺序，所以用两个队列就可以。

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
        vector<vector<int>> Print(TreeNode* pRoot) 
        {
            vector<vector<int>> result;
            if(pRoot == NULL) return result;
            queue<TreeNode*> que1;
            queue<TreeNode*> que2;
            que1.push(pRoot);
            vector<int> temp;
            temp.push_back(pRoot -> val);
            result.push_back(temp);
            temp.clear();
            while(!que1.empty() || !que2.empty())
            {
                while(!que1.empty())
                {
                    TreeNode* front1 = que1.front();
                    que1.pop();
                    if(front1 -> left)
                    {
                        que2.push(front1 -> left);
                        temp.push_back(front1 -> left -> val);
                    }
                    if(front1 -> right)
                    {
                        que2.push(front1 -> right);
                        temp.push_back(front1 -> right -> val);
                    }
                }
                if(!temp.empty())
                {
                    result.push_back(temp);
                    temp.clear();
                }
                while(!que2.empty())
                {
                    TreeNode* front2 = que2.front();
                    que2.pop();
                    if(front2 -> left)
                    {
                        que1.push(front2 -> left);
                        temp.push_back(front2 -> left -> val);
                    }
                    if(front2 -> right)
                    {
                        que1.push(front2 -> right);
                        temp.push_back(front2 -> right -> val);
                    }
                }
                if(!temp.empty())
                {
                    result.push_back(temp);
                    temp.clear();
                }
            }
            return result;
        }
};
```

