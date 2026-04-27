import os
import json
import csv
import uuid
import time
import re
import requests
import sys

try:
    csv.field_size_limit(sys.maxsize)
except OverflowError:
    csv.field_size_limit(2**31 - 1)

SOURCES = {
    "en_roles": {
        "url": "https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv",
        "format": "csv",
        "lang": "en",
        "name": "ChatGPT Prompts (English)",
        "filename": "roles.json",
        "id_suffix": "roles",
        "pack_description": "Collection of {count} role-play prompts.",
        "tags": ["roleplay"]
    },
    "zh_roles": {
        "url": "https://raw.githubusercontent.com/PlexPt/awesome-chatgpt-prompts-zh/main/prompts-zh.json",
        "format": "json",
        "lang": "zh",
        "name": "中文角色扮演精选",
        "filename": "roles.json",
        "id_suffix": "roles",
        "pack_description": "Collection of {count} role-play prompts.",
        "tags": ["roleplay"]
    },
    "en_image2": {
        "url": "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main/README.md",
        "format": "markdown_image2",
        "lang": "en",
        "name": "Awesome GPT Image 2 Prompts",
        "filename": "image2.json",
        "id_suffix": "image2",
        "pack_description": "Collection of {count} GPT Image 2 prompts.",
        "tags": ["image2", "image-generation"],
        "default_group": "Creative"
    },
    "zh_image2": {
        "url": "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main/README_zh.md",
        "format": "markdown_image2",
        "lang": "zh",
        "name": "GPT Image 2 提示词精选",
        "filename": "image2.json",
        "id_suffix": "image2",
        "pack_description": "Collection of {count} GPT Image 2 prompts.",
        "tags": ["image2", "image-generation"],
        "default_group": "Creative"
    }
}

DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")
PACKS_ROOT = os.path.join(DIST_DIR, "packs", "prompts")

if not os.path.exists(DIST_DIR):
    os.makedirs(DIST_DIR)
if not os.path.exists(PACKS_ROOT):
    os.makedirs(PACKS_ROOT)

CATEGORY_MAP = {
    "coding": [
        "linux", "terminal", "console", "code", "script", "sql", "javascript", "python", "java", 
        "css", "html", "programming", "developer", "bug", "php", "react", "stack", "git", "regex",
        "编程", "代码", "终端", "开发", "程序员", "算法", "架构"
    ],
    "writing": [
        "writer", "story", "poem", "essay", "blog", "article", "title", "editor", "proofread", "screenwriter",
        "写手", "故事", "文章", "周报", "作文", "润色", "小说", "编剧", "文案", "ghostwriter"
    ],
    "academic": [
        "translator", "translate", "spell", "corrector", "academic", "math", "tutor", "teacher", "language",
        "翻译", "英语", "数学", "老师", "导师", "学术", "雅思", "词典"
    ],
    "creative": [
        "musician", "artist", "rapper", "composer", "song", "design", "midjourney", "image", "svg",
        "画家", "音乐", "歌词", "设计", "艺术", "作曲", "video"
    ],
    "productivity": [
        "excel", "sheet", "planner", "schedule", "summary", "summarizer", "coach", "manager",
        "表格", "计划", "总结", "经理", "顾问", "助手", "startup"
    ]
}

def get_current_timestamp():
    return int(time.time() * 1000)

def generate_uuid():
    return str(uuid.uuid4())

def determine_group(text):
    text_lower = text.lower()
    for group, keywords in CATEGORY_MAP.items():
        for keyword in keywords:
            if keyword in text_lower:
                return group.capitalize()
    return "Roleplay"

def clean_raw_content(content):
    """
    深度清洗源文本，去除元数据、链接和格式噪音
    """
    content = re.sub(r'(?i)(?m)^\s*(?:Contributed by|贡献者|From|Author)[\s:：].*?(\n|$)', '', content)
    content = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', content)
    content = re.sub(r'(?m)^>\s*', '', content)
    content = re.sub(r'!\[[^\]]*\]\([^\)]+\)', '', content)

    return content.strip()

def normalize_placeholders(content):
    """
    将各种格式的占位符统一转换为 {{variable}} 格式
    """
    content = re.sub(r'\$\{([a-zA-Z0-9_]+)(?::[^}]+)?\}', r'{{\1}}', content)
    content = re.sub(r'\[([a-zA-Z0-9_\s\u4e00-\u9fa5]+)\](?!\()', r'{{\1}}', content)
    content = re.sub(r'(?<!\{)\{([a-zA-Z0-9_\s\u4e00-\u9fa5]+)\}(?!\})', r'{{\1}}', content)

    return content

def inject_variables_advanced(content, lang):
    """
    智能替换：将示例内容替换为 {{input}}
    """
    if lang == "en":
        pattern = r"((?:My|The)\s+first\s+[\w\s]+\s+is\s*[:：]?\s*)([\"“'])([\s\S]*?)\2([\.。]?)\s*$"
        match = re.search(pattern, content, re.IGNORECASE)
        if match:
            return re.sub(pattern, r'\1{{input}}\4', content, flags=re.IGNORECASE)

        pattern_no_quote = r"((?:My|The)\s+first\s+[\w\s]+\s+is\s*[:：]?\s*)([^\n]+)$"
        match_nq = re.search(pattern_no_quote, content, re.IGNORECASE)
        if match_nq:
            if len(match_nq.group(2)) < 150:
                return re.sub(pattern_no_quote, r'\1{{input}}', content, flags=re.IGNORECASE)

    if lang == "zh":
        pattern = r"((?:我的?)?第一[个句条项次][\u4e00-\u9fa5\w\s]+?是\s*[:：]?\s*)([“\"'])([\s\S]*?)\2([\.。]?)\s*$"
        match = re.search(pattern, content)
        if match:
            return re.sub(pattern, r'\1{{input}}\4', content)

        pattern_no_quote = r"((?:我的?)?第一[个句条项次][\u4e00-\u9fa5\w\s]+?是\s*[:：]?\s*)([^\n]+)$"
        match_nq = re.search(pattern_no_quote, content)
        if match_nq:
            if len(match_nq.group(2)) < 150:
                return re.sub(pattern_no_quote, r'\1{{input}}', content)

    return content

def parse_markdown_image2(raw_data, lang):
    prompts = []
    seen = set()
    entry_pattern = re.compile(
        r"^###\s+No\.\s*\d+:\s*(?P<title>.+?)\n(?P<body>[\s\S]*?)(?=^###\s+No\.\s*\d+:|\Z)",
        re.MULTILINE
    )

    for match in entry_pattern.finditer(raw_data):
        title = clean_raw_content(match.group("title")).strip()
        body = match.group("body")

        description_match = re.search(
            r"^#### .*?(?:Description|描述)\s*\n(?P<description>[\s\S]*?)(?=^#### )",
            body,
            re.MULTILINE
        )
        prompt_match = re.search(
            r"^#### .*?(?:Prompt|提示词)\s*\n```(?:\w+)?\n(?P<prompt>[\s\S]*?)```",
            body,
            re.MULTILINE
        )

        if not prompt_match:
            continue

        description = ""
        if description_match:
            description = clean_raw_content(description_match.group("description")).strip()
        prompt = prompt_match.group("prompt").strip()
        dedupe_key = (title, prompt)
        if not title or not prompt or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        prompts.append({
            "act": title,
            "prompt": prompt,
            "description": description
        })

    return prompts

def process_source(key, config):
    print(f"Downloading {config['name']}...")
    try:
        response = requests.get(config['url'], timeout=15)
        response.raise_for_status()
    except Exception as e:
        print(f"Failed to download {key}: {e}")
        return None

    prompts = []
    raw_data = response.text

    if config['format'] == 'csv':
        # 这里会用到上面设置的 field_size_limit
        reader = csv.DictReader(raw_data.splitlines())
        for row in reader:
            act = row.get('act', '').strip()
            prompt_content = row.get('prompt', '').strip()
            if act and prompt_content:
                prompts.append({"act": act, "prompt": prompt_content})

    elif config['format'] == 'json':
        try:
            json_data = json.loads(raw_data)
            for item in json_data:
                prompts.append({
                    "act": item.get('act', '').strip(),
                    "prompt": item.get('prompt', '').strip()
                })
        except json.JSONDecodeError:
            print(f"JSON Decode Error for {key}")
            return None
    elif config['format'] == 'markdown_image2':
        prompts = parse_markdown_image2(raw_data, config['lang'])
    else:
        print(f"Unsupported format for {key}: {config['format']}")
        return None

    final_prompts = []
    for item in prompts:
        title = item['act']
        raw_content = item['prompt']
        item_description = item.get('description', '').strip()

        cleaned_content = clean_raw_content(raw_content)

        if not cleaned_content:
            print(f"Skipped empty prompt: {title}")
            continue

        group = config.get('default_group') or determine_group(title + " " + item_description + " " + cleaned_content)

        normalized_content = normalize_placeholders(cleaned_content)

        final_content = inject_variables_advanced(normalized_content, config['lang'])

        prompt_tags = [config['lang'], *config.get('tags', []), group.lower()]
        prompt_obj = {
            "id": generate_uuid(),
            "type": "prompt",
            "title": title,
            "content": final_content,
            "group": group,
            "description": item_description or f"{title} - AI Prompt",
            "tags": prompt_tags,
            "isFavorite": False,
            "createdAt": get_current_timestamp(),
            "updatedAt": get_current_timestamp(),
            "source": "official"
        }
        final_prompts.append(prompt_obj)

    # 确保目录结构 packs/prompts/{lang}/
    lang_dir = os.path.join(PACKS_ROOT, config['lang'])
    if not os.path.exists(lang_dir):
        os.makedirs(lang_dir)

    filename = config.get("filename", "roles.json")
    output_path = os.path.join(lang_dir, filename)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(final_prompts, f, ensure_ascii=False, indent=2)

    print(f"Generated {config['lang']}/{filename}: {len(final_prompts)} prompts in prompts/ folder.")

    return {
        "id": f"{config['lang']}-{config.get('id_suffix', 'roles')}",
        "language": config['lang'],
        "platform": "llm",
        "name": config['name'],
        "description": config.get("pack_description", "Collection of {count} prompts.").format(count=len(final_prompts)),
        "count": len(final_prompts),
        "size_kb": round(os.path.getsize(output_path) / 1024, 2),
        "url": f"packs/prompts/{config['lang']}/{filename}",
        "category": "prompt"
    }

def main():
    print("Starting Prompt ETL Process (Folder Structure Refactored)...")
    manifest_items = []
    for key, config in SOURCES.items():
        result = process_source(key, config)
        if result:
            manifest_items.append(result)

    temp_manifest_path = os.path.join(DIST_DIR, "manifest_prompts_partial.json")
    with open(temp_manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest_items, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
