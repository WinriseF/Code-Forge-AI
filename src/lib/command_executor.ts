import { Command } from '@tauri-apps/plugin-shell';
import { type as getOsType } from '@tauri-apps/plugin-os';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { join, tempDir } from '@tauri-apps/api/path';
import { ShellType } from '@/types/prompt';

const DANGEROUS_KEYWORDS = [
  'rm ', 'del ', 'remove-item', 'mv ', 'move ', 'format', 'mkfs', '>', 'chmod ', 'chown ', 'icacls '
];

const checkCommandRisk = (commandStr: string): boolean => {
  const lowerCaseCmd = commandStr.toLowerCase().trim();
  return DANGEROUS_KEYWORDS.some(keyword => {
    if (keyword === '>') return lowerCaseCmd.includes('>');
    return new RegExp(`\\b${keyword}`).test(lowerCaseCmd);
  });
};

const showNotification = async (msg: string, type: 'info' | 'error' = 'info') => {
  await message(msg, { title: 'CodeForge AI', kind: type });
};

export async function executeCommand(commandStr: string, _shell: ShellType = 'auto', cwd?: string | null) {
  if (checkCommandRisk(commandStr)) {
    const confirmed = await ask(
      `警告：此命令包含潜在风险。\n\n命令: "${commandStr}"\n\n确定执行吗？`,
      { title: '操作确认', kind: 'warning', okLabel: '执行', cancelLabel: '取消' }
    );
    if (!confirmed) return;
  }

  const osType = await getOsType();
  
  try {
    const baseDir = await tempDir();
    // 移除路径末尾可能存在的反斜杠，防止转义引号
    const cleanCwd = (cwd || baseDir).replace(/[\\/]$/, ''); 
    const timestamp = Date.now();

    if (osType === 'windows') {
      const fileName = `codeforge_exec_${timestamp}.bat`;
      const scriptPath = await join(baseDir, fileName);
      
      // 关键修复：
      // 1. 移除所有中文注释，防止 GBK/UTF-8 编码冲突导致的乱码和语法错误
      // 2. 确保 cd 路径被引号包裹
      const fileContent = `
@echo off
cd /d "${cleanCwd}"
cls
ver
echo (c) Microsoft Corporation. All rights reserved.
echo.

:: Enable echo to simulate terminal behavior
@echo on
${commandStr}
@echo off

echo.
pause
start /b "" cmd /c del "%~f0"&exit /b
      `.trim();

      await writeTextFile(scriptPath, fileContent);
      const cmd = Command.create('cmd', ['/c', 'start', '', scriptPath]);
      await cmd.spawn();

    } else if (osType === 'macos') {
      const fileName = `codeforge_exec_${timestamp}.sh`;
      const scriptPath = await join(baseDir, fileName);

      const fileContent = `
#!/bin/bash
clear
cd "${cleanCwd}"
echo "$(pwd) $ ${commandStr.split('\n').join('\n> ')}"
${commandStr}
echo ""
echo "[Process completed]"
read -n 1 -s -r -p "Press any key to close..."
rm "$0"
      `.trim();

      await writeTextFile(scriptPath, fileContent);
      
      const appleScript = `
        tell application "Terminal"
          activate
          do script "sh '${scriptPath}'"
        end tell
      `;
      const cmd = Command.create('osascript', ['-e', appleScript]);
      await cmd.spawn();

    } else if (osType === 'linux') {
      const fileName = `codeforge_exec_${timestamp}.sh`;
      const scriptPath = await join(baseDir, fileName);

      const fileContent = `
#!/bin/bash
cd "${cleanCwd}"
echo "$(pwd) $ ${commandStr.split('\n').join('\n> ')}"
${commandStr}
echo ""
echo "Press Enter to close..."
read
rm "$0"
      `.trim();

      await writeTextFile(scriptPath, fileContent);
      const cmd = Command.create('x-terminal-emulator', ['-e', `bash "${scriptPath}"`]);
      await cmd.spawn();

    } else {
      await showNotification("Unsupported OS", "error");
    }

  } catch (e: any) {
    console.error("Execution failed:", e);
    await showNotification(`执行失败: ${e.message || e}`, "error");
  }
}