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
        "platform": "llm",
        "source": "official",
        "pack_description": "Collection of {count} role-play prompts.",
        "tags": ["roleplay"],
    },
    "zh_roles": {
        "url": "https://raw.githubusercontent.com/PlexPt/awesome-chatgpt-prompts-zh/main/prompts-zh.json",
        "format": "json",
        "lang": "zh",
        "name": "中文角色扮演精选",
        "filename": "roles.json",
        "id_suffix": "roles",
        "platform": "llm",
        "source": "official",
        "pack_description": "Collection of {count} role-play prompts.",
        "tags": ["roleplay"],
    },
    "en_image2": {
        "url": "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main/README.md",
        "format": "markdown_prompt_readme",
        "lang": "en",
        "name": "Awesome GPT Image 2 Prompts",
        "filename": "image2.json",
        "id_suffix": "image2",
        "platform": "image",
        "source": "awesome-gpt-image-2",
        "pack_description": "Collection of {count} GPT Image 2 prompts.",
        "tags": ["image2", "gpt-image-2", "image-generation"],
        "default_group": "Creative",
    },
    "zh_image2": {
        "url": "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main/README_zh.md",
        "format": "markdown_prompt_readme",
        "lang": "zh",
        "name": "GPT Image 2 提示词精选",
        "filename": "image2.json",
        "id_suffix": "image2",
        "platform": "image",
        "source": "awesome-gpt-image-2",
        "pack_description": "Collection of {count} GPT Image 2 prompts.",
        "tags": ["image2", "gpt-image-2", "image-generation", "图像生成"],
        "default_group": "Creative",
    },
    "en_seedance2": {
        "url": "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-seedance-2-prompts/main/README.md",
        "format": "markdown_prompt_readme",
        "lang": "en",
        "name": "Awesome Seedance 2.0 Video Prompts",
        "filename": "seedance2.json",
        "id_suffix": "seedance2",
        "platform": "video",
        "source": "awesome-seedance-2-prompts",
        "pack_description": "Collection of {count} Seedance 2.0 video-generation prompts.",
        "tags": ["seedance2", "seedance-2", "video-generation"],
        "default_group": "Creative",
    },
    "zh_seedance2": {
        "url": "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-seedance-2-prompts/main/README_zh.md",
        "format": "markdown_prompt_readme",
        "lang": "zh",
        "name": "Seedance 2.0 视频提示词精选",
        "filename": "seedance2.json",
        "id_suffix": "seedance2",
        "platform": "video",
        "source": "awesome-seedance-2-prompts",
        "pack_description": "Collection of {count} Seedance 2.0 video-generation prompts.",
        "tags": ["seedance2", "seedance-2", "video-generation", "视频生成"],
        "default_group": "Creative",
    },
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
        "编程", "代码", "终端", "开发", "程序员", "算法", "架构",
    ],
    "writing": [
        "writer", "story", "poem", "essay", "blog", "article", "title", "editor", "proofread", "screenwriter",
        "写手", "故事", "文章", "周报", "作文", "润色", "小说", "编剧", "文案", "ghostwriter",
    ],
    "academic": [
        "translator", "translate", "spell", "corrector", "academic", "math", "tutor", "teacher", "language",
        "翻译", "英语", "数学", "老师", "导师", "学术", "雅思", "词典",
    ],
    "creative": [
        "musician", "artist", "rapper", "composer", "song", "design", "midjourney", "image", "svg",
        "gpt image", "seedance", "video", "poster", "avatar", "thumbnail", "photography", "cinematic",
        "anime", "manga", "illustration", "comic", "storyboard", "3d render", "pixel art", "watercolor", "oil painting",
        "画家", "音乐", "歌词", "设计", "艺术", "作曲", "图像", "图片", "视频", "海报", "插画", "漫画", "摄影", "水彩",
    ],
    "productivity": [
        "excel", "sheet", "planner", "schedule", "summary", "summarizer", "coach", "manager",
        "表格", "计划", "总结", "经理", "顾问", "助手", "startup",
    ],
}


def get_current_timestamp():
    return int(time.time() * 1000)


def generate_uuid():
    return str(uuid.uuid4())


def generate_stable_uuid(seed):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def unique_list(items):
    result = []
    seen = set()
    for item in items:
        if not item:
            continue
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


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
    content = re.sub(r'(?i)(?m)^\s*(?:Contributed by|贡献者|From|Author|作者)[\s:：].*?(\n|$)', '', content)
    content = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', content)
    content = re.sub(r'(?m)^>\s*', '', content)
    content = re.sub(r'!\[[^\]]*\]\([^\)]+\)', '', content)

    return content.strip()


def normalize_raycast_arguments(content):
    """
    将 Raycast Snippets 参数转换成 CtxRun 支持的 {{variable}} 格式。
    例: {argument name="quote" default="Stay hungry"} -> {{quote}}
    """

    def replace_argument(match):
        name = match.group(2).strip()
        safe_name = re.sub(r'[^a-zA-Z0-9_\u4e00-\u9fa5\s-]+', '', name)
        safe_name = re.sub(r'[\s-]+', '_', safe_name).strip('_')
        return "{{" + (safe_name or "input") + "}}"

    pattern = r'\{argument\s+name=(\"|\')([^\"\']+)\1(?:\s+default=(\"|\')[^\"\']*\3)?\s*\}'
    return re.sub(pattern, replace_argument, content)


def normalize_placeholders(content):
    """
    将各种格式的占位符统一转换为 {{variable}} 格式
    """
    content = normalize_raycast_arguments(content)
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


def clean_markdown_title(raw_title):
    title = clean_raw_content(raw_title).strip()
    title = re.sub(r'^No\.\s*\d+\s*[:：]\s*', '', title, flags=re.IGNORECASE)
    return title.strip()


def extract_markdown_description(body, prompt_start):
    description_match = re.search(
        r"^####\s+.*?(?:Description|描述)\s*\n(?P<description>[\s\S]*?)(?=^####\s+)",
        body,
        re.MULTILINE | re.IGNORECASE,
    )
    if description_match:
        return clean_raw_content(description_match.group("description")).strip()

    before_prompt = body[:prompt_start]
    quote_lines = []
    for line in before_prompt.splitlines():
        if line.strip().startswith(">"):
            quote_lines.append(re.sub(r"^\s*>\s?", "", line).strip())
    return clean_raw_content("\n".join(quote_lines)).strip()


def extract_external_id(text):
    id_match = re.search(r'[?&]id=([^\s\)]+)', text)
    if id_match:
        return id_match.group(1).strip()

    video_match = re.search(r'/videos/(\d+)\.mp4', text)
    if video_match:
        return video_match.group(1).strip()

    return ""


def extract_markdown_details(body):
    details = []

    author_match = re.search(r'\*\*(?:Author|作者):\*\*\s*(.+)', body, re.IGNORECASE)
    if author_match:
        author = clean_raw_content(author_match.group(1)).strip()
        if author:
            details.append(f"Author: {author}")

    published_match = re.search(r'\*\*(?:Published|发布时间|发布日期):\*\*\s*([^\n]+)', body, re.IGNORECASE)
    if published_match:
        published = clean_raw_content(published_match.group(1)).strip()
        if published:
            details.append(f"Published: {published}")

    try_match = re.search(
        r'\*\*\[[^\]]*(?:Try it now|立即尝试|Watch Video|观看视频)[^\]]*\]\(([^\)]+)\)\*\*',
        body,
        re.IGNORECASE,
    )
    if try_match:
        details.append(f"Source: {try_match.group(1).strip()}")
    else:
        source_match = re.search(r'\*\*(?:Source|来源):\*\*\s*\[[^\]]+\]\(([^\)]+)\)', body, re.IGNORECASE)
        if source_match:
            details.append(f"Source: {source_match.group(1).strip()}")

    return details


def parse_markdown_prompt_readme(raw_data, config):
    """
    解析 YouMind OpenLab 的 prompt README。

    支持两类条目：
    - Featured: ### No. 1: Title
    - All Prompts: ### Title

    只要 H3 段落内包含 #### Prompt / #### 提示词，就转换成 CtxRun prompt。
    """
    prompts = []
    seen = set()
    heading_pattern = re.compile(r"^###\s+(?P<title>.+?)\s*$", re.MULTILINE)
    headings = list(heading_pattern.finditer(raw_data))

    for index, heading in enumerate(headings):
        raw_title = heading.group("title")
        title = clean_markdown_title(raw_title)
        section_end = headings[index + 1].start() if index + 1 < len(headings) else len(raw_data)
        body = raw_data[heading.end():section_end]

        prompt_match = re.search(
            r"^####\s+.*?(?:Prompt|提示词)\s*\n\s*```(?:[a-zA-Z0-9_-]+)?\s*\n(?P<prompt>[\s\S]*?)\n```",
            body,
            re.MULTILINE | re.IGNORECASE,
        )
        if not prompt_match:
            continue

        raw_prompt = prompt_match.group("prompt").strip()
        if not title or not raw_prompt:
            continue

        description = extract_markdown_description(body, prompt_match.start())
        details = extract_markdown_details(body)
        external_id = extract_external_id(body)

        dedupe_key = (title.lower(), raw_prompt)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        description_parts = []
        if description:
            description_parts.append(description)
        description_parts.extend(details)

        prompts.append({
            "act": title,
            "prompt": raw_prompt,
            "description": " | ".join(description_parts),
            "external_id": external_id,
        })

    return prompts


def process_source(key, config):
    print(f"Downloading {config['name']}...")
    try:
        response = requests.get(config['url'], timeout=30)
        response.raise_for_status()
    except Exception as e:
        print(f"Failed to download {key}: {e}")
        return None

    prompts = []
    raw_data = response.text

    if config['format'] == 'csv':
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
                    "prompt": item.get('prompt', '').strip(),
                })
        except json.JSONDecodeError:
            print(f"JSON Decode Error for {key}")
            return None

    elif config['format'] == 'markdown_prompt_readme':
        prompts = parse_markdown_prompt_readme(raw_data, config)

    else:
        print(f"Unsupported format for {key}: {config['format']}")
        return None

    final_prompts = []
    is_markdown_pack = config['format'] == 'markdown_prompt_readme'
    now = get_current_timestamp()

    for item in prompts:
        title = item['act']
        raw_content = item['prompt']
        item_description = item.get('description', '').strip()

        cleaned_content = clean_raw_content(raw_content)

        if not cleaned_content:
            print(f"Skipped empty prompt: {title}")
            continue

        group = config.get('default_group') or determine_group(
            title + " " + item_description + " " + cleaned_content
        )

        if is_markdown_pack:
            normalized_content = normalize_raycast_arguments(cleaned_content)
        else:
            normalized_content = normalize_placeholders(cleaned_content)

        final_content = inject_variables_advanced(normalized_content, config['lang'])

        prompt_tags = unique_list([config['lang'], *config.get('tags', []), group.lower()])

        if is_markdown_pack:
            stable_seed = (
                f"{config.get('source')}:{config['lang']}:"
                f"{item.get('external_id') or title}:{final_content[:240]}"
            )
            prompt_id = generate_stable_uuid(stable_seed)
        else:
            prompt_id = generate_uuid()

        prompt_obj = {
            "id": prompt_id,
            "type": "prompt",
            "title": title,
            "content": final_content,
            "group": group,
            "description": item_description or f"{title} - AI Prompt",
            "tags": prompt_tags,
            "isFavorite": False,
            "createdAt": now,
            "updatedAt": now,
            "source": config.get("source", "official"),
        }
        final_prompts.append(prompt_obj)

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
        "platform": config.get("platform", "llm"),
        "name": config['name'],
        "description": config.get(
            "pack_description",
            "Collection of {count} prompts."
        ).format(count=len(final_prompts)),
        "count": len(final_prompts),
        "size_kb": round(os.path.getsize(output_path) / 1024, 2),
        "url": f"packs/prompts/{config['lang']}/{filename}",
        "category": "prompt",
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