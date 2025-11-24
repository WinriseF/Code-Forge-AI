import os
import re
import json
from pathlib import Path
import time

# ================= 配置区域 =================

# 1. 锚定脚本所在位置 (build 目录)
SCRIPT_DIR = Path(__file__).parent.resolve()

# 2. 输出根目录
OUTPUT_DIR = SCRIPT_DIR / 'dist'

# 3. 多语言源配置
LANG_CONFIG = {
    'zh': {
        'source': SCRIPT_DIR / 'tldr' / 'pages.zh',
        'names': {
            'common': '通用工具 (Common)',
            'linux': 'Linux 运维',
            'android': 'Android 开发',
            'windows': 'Windows',
            'osx': 'macOS',
            'sunos': 'SunOS'
        }
    },
    'en': {
        'source': SCRIPT_DIR / 'tldr' / 'pages',
        'names': {
            'common': 'Common Tools',
            'linux': 'Linux Ops',
            'android': 'Android Dev',
            'windows': 'Windows',
            'osx': 'macOS',
            'sunos': 'SunOS'
        }
    }
}

# ===========================================

def parse_markdown(content, cmd_name, platform, lang, platform_display_name):
    """
    解析单个 Markdown 文件内容
    """
    prompts = []
    lines = content.splitlines()

    # --- 1. 提取并清洗描述 (Description) ---
    desc_lines = []
    for line in lines:
        line = line.strip()
        # 只处理引用行
        if line.startswith('>'):
            # 去掉开头的 '> '
            clean_line = line[1:].strip()
            
            # 1.1 去除 Markdown 链接和 HTML 标签
            clean_line = re.sub(r'<[^>]+>|\[([^\]]+)\]\([^\)]+\)', '', clean_line)
            
            # 1.2 ✨ 核心清洗：直接丢弃包含 "更多信息" 或 "More information" 的行
            if re.search(r'(?:More information|更多信息|See also|参见)\s*[:：]', clean_line, re.IGNORECASE):
                continue
            
            # 1.3 去除末尾残留的标点
            clean_line = clean_line.strip()
            
            if clean_line:
                desc_lines.append(clean_line)

    description = ' '.join(desc_lines) or f"{cmd_name} command"

    # --- 2. 提取命令 (Actions) ---
    current_action = None
    index = 0
    
    for line in lines:
        line = line.strip()
        
        if line.startswith('- '):
            # ✨ 核心清洗：去除末尾的 英文冒号(:)、中文冒号(：)、句号(.) 和 空格
            raw_action = line[2:]
            current_action = re.sub(r'[:：\.\s]+$', '', raw_action)
        
        elif line.startswith('`') and line.endswith('`') and current_action:
            code_content = line.strip('`')
            
            prompts.append({
                "id": f"tldr-{lang}-{platform}-{cmd_name}-{index}",
                # 增加 type 字段，方便前端双轨制区分
                "type": "command", 
                "title": f"{cmd_name} - {current_action}",
                "content": code_content,
                "group": platform_display_name, 
                "description": f"{cmd_name}: {description} ({current_action})",
                "tags": [platform, cmd_name, 'tldr', lang],
                "source": "official"
            })
            
            current_action = None
            index += 1
            
    return prompts

def main():
    print("🚀 开始构建 CodeForgeAI 指令库 (双语版)...")
    print(f"📍 脚本位置: {SCRIPT_DIR}")

    # 清理输出目录
    if not OUTPUT_DIR.exists():
        OUTPUT_DIR.mkdir(parents=True)

    manifest_packages = []
    
    for lang, config in LANG_CONFIG.items():
        source_dir = config['source']
        names_map = config['names']
        
        print(f"\n🌐 正在处理语言: [{lang}]")
        print(f"   源路径: {source_dir}")

        if not source_dir.exists():
            print(f"❌ 错误: 找不到源目录 {source_dir}，跳过此语言。")
            continue

        # 确保该语言的输出目录存在
        lang_pack_dir = OUTPUT_DIR / 'packs' / lang
        if not lang_pack_dir.exists():
            lang_pack_dir.mkdir(parents=True)

        # 动态扫描该源目录下的所有子文件夹作为平台
        platforms = [d.name for d in source_dir.iterdir() if d.is_dir()]
        
        for platform in platforms:
            platform_path = source_dir / platform
            display_name = names_map.get(platform, platform.title())

            print(f"   📦 处理平台: {platform} ({display_name})...")
            
            all_platform_prompts = []
            md_files = list(platform_path.glob('*.md'))

            for file_path in md_files:
                try:
                    content = file_path.read_text(encoding='utf-8')
                    cmd_name = file_path.stem 
                    
                    prompts = parse_markdown(content, cmd_name, platform, lang, display_name)
                    all_platform_prompts.extend(prompts)
                except Exception as e:
                    print(f"      ❌ 解析失败: {file_path.name} - {e}")

            if all_platform_prompts:
                output_filename = f"{platform}.json"
                output_path = lang_pack_dir / output_filename
                
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(all_platform_prompts, f, ensure_ascii=False, indent=2)
                
                size_kb = round(output_path.stat().st_size / 1024)
                
                manifest_packages.append({
                    "id": f"{lang}-{platform}",
                    "language": lang,
                    "platform": platform,
                    "name": f"{display_name} ({lang.upper()})",
                    "description": f"Contains {len(all_platform_prompts)} {lang} commands for {platform}.",
                    "count": len(all_platform_prompts),
                    "size_kb": size_kb,
                    "url": f"packs/{lang}/{output_filename}",
                    "category": "command" # ✨ 新增：标记为指令包，用于商店分类
                })

    # --- 修改重点：生成局部索引清单 (Partial Manifest) ---
    # 不再生成完整的 manifest.json，而是生成一个列表文件
    # 具体的 Version 和 Timestamp 由 Workflow 合并脚本统一生成
    
    partial_manifest_path = OUTPUT_DIR / 'manifest_tldr_partial.json'
    
    with open(partial_manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest_packages, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 局部构建完成! 清单片段已生成: {partial_manifest_path}")
    print(f"👉 产物目录: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()