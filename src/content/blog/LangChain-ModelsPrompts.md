---
title: "LangChain Models+Prompts"
description: "LangChain学习"
date: "2023-04-08"
tags: []
draft: false
featured: false
readingTime: 10
---
- [1.安装](#1安装)
- [2.环境配置](#2环境配置)
- [3.简单LLM预测](#3简单llm预测)
- [4.Prompt Templates](#4prompt-templates)
    - [4.1 简单示例：](#41-简单示例)
    - [4.2 多个可变参数示例：](#42-多个可变参数示例)
    - [4.3 从LangChainHub获取现成的promtps：](#43-从langchainhub获取现成的promtps)
    - [4.4 fewshot prompt template](#44-fewshot-prompt-template)
    - [4.5 partial prompt template](#45-partial-prompt-template)
    - [4.6 序列化我们的prompts](#46-序列化我们的prompts)
    - [4.7 Output Parsers](#47-output-parsers)


## 1.安装
```
pip install langchain
```

---

## 2.环境配置
For this example, we will be using OpenAI’s APIs, so we will first need to install their SDK:
```bash
pip install openai
```

We will then need to set the environment variable in the terminal.
```bash
export OPENAI_API_KEY="..."
```

Alternatively, you could do this from inside the Jupyter notebook (or Python script):
```python
import os
os.environ["OPENAI_API_KEY"] = "..."
```
---

## 3.简单LLM预测
```python
from langchain.llms import OpenAI

llm = OpenAI(temperature=0.9)
text = "What would be a good company name for a company that makes colorful socks?"
print(llm(text))
```
结果：  
`Feetful of Fun`

---
## 4.Prompt Templates
#### 4.1 简单示例：
```python
from langchain.prompts import PromptTemplate

prompt = PromptTemplate(
    input_variables=["product"],
    template="What is a good name for a company that makes {product}?",
)
print(prompt.format(product="colorful socks"))
```
```shell
What is a good name for a company that makes colorful socks?
```

---

#### 4.2 多个可变参数示例：
```python
from langchain import PromptTemplate

# 无输入
no_input_prompt = PromptTemplate(input_variables=[], template="Tell me a joke.")
no_input_prompt.format()
# -> "Tell me a joke."

# 只有一个输入
one_input_prompt = PromptTemplate(input_variables=["adjective"], template="Tell me a {adjective} joke.")
one_input_prompt.format(adjective="funny")
# -> "Tell me a funny joke."

# 多个输入
multiple_input_prompt = PromptTemplate(
    input_variables=["adjective", "content"], 
    template="Tell me a {adjective} joke about {content}."
)
multiple_input_prompt.format(adjective="funny", content="chickens")
# -> "Tell me a funny joke about chickens."
```

---

#### 4.3 从[LangChainHub](https://github.com/hwchase17/langchain-hub)获取现成的promtps：
```python
from langchain.prompts import load_prompt

prompt = load_prompt("lc://prompts/conversation/prompt.json")
prompt.format(history="", input="What is 1 + 1?")
```

---

#### 4.4 fewshot prompt template
Few shot examples 会在prompt中添加示例，可以用来帮助语言模型生成更好的响应。如果要使用fewshot，需要引入`FewShotPromptTemplate`。下面是一个示例：
```python
from langchain import PromptTemplate, FewShotPromptTemplate


# First, create the list of few shot examples.
examples = [
    {"word": "happy", "antonym": "sad"},
    {"word": "tall", "antonym": "short"},
]

# Next, we specify the template to format the examples we have provided.
# We use the `PromptTemplate` class for this.
example_formatter_template = """
Word: {word}
Antonym: {antonym}\n
"""
example_prompt = PromptTemplate(
    input_variables=["word", "antonym"],
    template=example_formatter_template,
)

# Finally, we create the `FewShotPromptTemplate` object.
few_shot_prompt = FewShotPromptTemplate(
    # These are the examples we want to insert into the prompt.
    examples=examples,
    # This is how we want to format the examples when we insert them into the prompt.
    example_prompt=example_prompt,
    # The prefix is some text that goes before the examples in the prompt.
    # Usually, this consists of intructions.
    prefix="Give the antonym of every input",
    # The suffix is some text that goes after the examples in the prompt.
    # Usually, this is where the user input will go
    suffix="Word: {input}\nAntonym:",
    # The input variables are the variables that the overall prompt expects.
    input_variables=["input"],
    # The example_separator is the string we will use to join the prefix, examples, and suffix together with.
    example_separator="\n\n",
)

# We can now generate a prompt using the `format` method.
print(few_shot_prompt.format(input="big"))
# -> Give the antonym of every input
# -> 
# -> Word: happy
# -> Antonym: sad
# ->
# -> Word: tall
# -> Antonym: short
# ->
# -> Word: big
# -> Antonym:
```
对于fewshot examples，工具提供了selector来选择使用哪些examples，我们可以使用`SemanticSimilarityExampleSelector`（从examples中选择语义相似度最高的）：
```python
from langchain.prompts.example_selector import SemanticSimilarityExampleSelector
from langchain.vectorstores import Chroma
from langchain.embeddings import OpenAIEmbeddings


example_selector = SemanticSimilarityExampleSelector.from_examples(
    # This is the list of examples available to select from.
    examples,
    # This is the embedding class used to produce embeddings which are used to measure semantic similarity.
    OpenAIEmbeddings(),
    # This is the VectorStore class that is used to store the embeddings and do a similarity search over.
    Chroma,
    # This is the number of examples to produce.
    k=1
)

# Select the most similar example to the input.
question = "Who was the father of Mary Ball Washington?"
selected_examples = example_selector.select_examples({"question": question})
print(f"Examples most similar to the input: {question}")
for example in selected_examples:
    print("\n")
    for k, v in example.items():
        print(f"{k}: {v}")
```
```
Running Chroma using direct local API.
Using DuckDB in-memory for database. Data will be transient.
Examples most similar to the input: Who was the father of Mary Ball Washington?


question: Who was the maternal grandfather of George Washington?
answer: 
Are follow up questions needed here: Yes.
Follow up: Who was the mother of George Washington?
Intermediate answer: The mother of George Washington was Mary Ball Washington.
Follow up: Who was the father of Mary Ball Washington?
Intermediate answer: The father of Mary Ball Washington was Joseph Ball.
So the final answer is: Joseph Ball
```
将selector选中的exapmle送入fewshot template：
```python
prompt = FewShotPromptTemplate(
    example_selector=example_selector, 
    example_prompt=example_prompt, 
    suffix="Question: {input}", 
    input_variables=["input"]
)

print(prompt.format(input="Who was the father of Mary Ball Washington?"))
```

---

#### 4.5 partial prompt template
想要部分提示模板的一个常见用例是，如果您先获得一些变量。例如，假设您有一个需要两个变量 foo 和 baz 的提示模板。如果您在链的早期获得 foo 值，但在稍后获得 baz 值，那么等待两个变量都位于同一位置以将它们传递给提示模板可能会很烦人。相反，您可以使用 foo 值部分提示模板，然后传递部分提示模板并使用它。下面是一个这样做的例子：
```python
from langchain.prompts import PromptTemplate

prompt = PromptTemplate(template="{foo}{bar}", input_variables=["foo", "bar"])
partial_prompt = prompt.partial(foo="foo");
print(partial_prompt.format(bar="baz"))
```
```
foobaz
```
应用示例：
这个用例是当你有一个你知道你总是想以通用方式获取的变量时。一个典型的例子是日期或时间。假设您有一个提示，您总是希望获得当前日期。您不能在提示中对其进行硬编码，并且将其与其他输入变量一起传递有点烦人。在这种情况下，能够使用始终返回当前日期的函数来部分提示是非常方便的。
```python
from datetime import datetime

def _get_datetime():
    now = datetime.now()
    return now.strftime("%m/%d/%Y, %H:%M:%S")

prompt = PromptTemplate(
    template="Tell me a {adjective} joke about the day {date}", 
    input_variables=["adjective", "date"]
);
partial_prompt = prompt.partial(date=_get_datetime)
print(partial_prompt.format(adjective="funny"))
```
```
Tell me a funny joke about the day 02/27/2023, 22:15:16
```
更简便的写法：
```python
prompt = PromptTemplate(
    template="Tell me a {adjective} joke about the day {date}", 
    input_variables=["adjective"],
    partial_variables={"date": _get_datetime}
);
print(prompt.format(adjective="funny"))
```

---

#### 4.6 序列化我们的prompts
除了使用python code储存我们的prompts，我们还可以将prompts存入文件，langchain提供了从JSON或YAML中读取prompts的能力。langchain支持在一个文件中指定所有内容，或者将不同的组件（模板、示例等）存储在不同的文件中并引用它们，如果想使用这个能力，需要引入：
```python
# All prompts are loaded through the `load_prompt` function.
from langchain.prompts import load_prompt
```

简单举例，如果想在一个JSON中读取一个简单的prompt template：
```json
{
    "_type": "prompt",
    "input_variables": ["adjective", "content"],
    "template": "Tell me a {adjective} joke about {content}."
}
```
```python
prompt = load_prompt("simple_prompt.json")
print(prompt.format(adjective="funny", content="chickens"))
```
同时还支持FewShotExample存入JSON等，具体可以见：[网页](https://python.langchain.com/en/latest/modules/prompts/prompt_templates/examples/prompt_serialization.html)

---

#### 4.7 Output Parsers
OutputParsers主要是让你结构化大模型的返回。使用OutputParsers主要有两个方法：
-   `get_format_instructions() -> str`: 一种返回字符串的方法，该字符串包含有关如何格式化语言模型输出的说明。
-   `parse(str) -> Any`: 一种接收字符串（假设是语言模型的响应）并将其解析为某种结构的方法。
-   `parse_with_prompt(str) -> Any`: 一种接受字符串（假设是来自语言模型的响应）和提示（假设生成此类响应的提示）并将其解析为某种结构的方法。

简单举例：
```python
from langchain.prompts import PromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate
from langchain.llms import OpenAI
from langchain.chat_models import ChatOpenAI

from langchain.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field, validator
from typing import List
```
```python
model_name = 'text-davinci-003'
temperature = 0.0
model = OpenAI(model_name=model_name, temperature=temperature)
```
```python
# Define your desired data structure.
class Joke(BaseModel):
    setup: str = Field(description="question to set up a joke")
    punchline: str = Field(description="answer to resolve the joke")
    
    # You can add custom validation logic easily with Pydantic.
    @validator('setup')
    def question_ends_with_question_mark(cls, field):
        if field[-1] != '?':
            raise ValueError("Badly formed question!")
        return field
```
```python
# Set up a parser + inject instructions into the prompt template.
parser = PydanticOutputParser(pydantic_object=Joke)
```
```python
prompt = PromptTemplate(
    template="Answer the user query.\n{format_instructions}\n{query}\n",
    input_variables=["query"],
    partial_variables={"format_instructions": parser.get_format_instructions()}
)
```
```python
# And a query intented to prompt a language model to populate the data structure.
joke_query = "Tell me a joke."
_input = prompt.format_prompt(query=joke_query)
```
```python
output = model(_input.to_string())
```
```python
parser.parse(output)
```

```json
Joke(setup='Why did the chicken cross the road?', punchline='To get to the other side!')
```

另外一种输出约定方法： CommaSeparatedListOutputParser，举例：
```python
from langchain.output_parsers import CommaSeparatedListOutputParser
from langchain.prompts import PromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate
from langchain.llms import OpenAI
from langchain.chat_models import ChatOpenAI

output_parser = CommaSeparatedListOutputParser()

format_instructions = output_parser.get_format_instructions()
prompt = PromptTemplate(
    template="List five {subject}.\n{format_instructions}",
    input_variables=["subject"],
    partial_variables={"format_instructions": format_instructions}
)

model = OpenAI(temperature=0)

_input = prompt.format(subject="ice cream flavors")
output = model(_input)

output_parser.parse(output)
```
输出：
```json
['Vanilla',
 'Chocolate',
 'Strawberry',
 'Mint Chocolate Chip',
 'Cookies and Cream']
```

一个更加简单的OutputParser：# Structured Output Parser，使用实例：
```python
from langchain.output_parsers import StructuredOutputParser, ResponseSchema
from langchain.prompts import PromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate
from langchain.llms import OpenAI
from langchain.chat_models import ChatOpenAI

response_schemas = [ # 输出规定
    ResponseSchema(name="answer", description="answer to the user's question"),
    ResponseSchema(name="source", description="source used to answer the user's question, should be a website.")
]
output_parser = StructuredOutputParser.from_response_schemas(response_schemas)

format_instructions = output_parser.get_format_instructions()
prompt = PromptTemplate(
    template="answer the users question as best as possible.\n{format_instructions}\n{question}",
    input_variables=["question"],
    partial_variables={"format_instructions": format_instructions}
)

model = OpenAI(temperature=0)
_input = prompt.format_prompt(question="what's the capital of france")
output = model(_input.to_string())
output_parser.parse(output)
```

```json
{'answer': 'Paris', 'source': 'https://en.wikipedia.org/wiki/Paris'}
```

下面是使用chatmodel的示例：
```python
chat_model = ChatOpenAI(temperature=0)

prompt = ChatPromptTemplate(
    messages=[
        HumanMessagePromptTemplate.from_template("answer the users question as best as possible.\n{format_instructions}\n{question}")  
    ],
    input_variables=["question"],
    partial_variables={"format_instructions": format_instructions}
)

_input = prompt.format_prompt(question="what's the capital of france")
output = chat_model(_input.to_messages())

output_parser.parse(output.content)
```

```json
{'answer': 'Paris', 'source': 'https://en.wikipedia.org/wiki/Paris'}
```

