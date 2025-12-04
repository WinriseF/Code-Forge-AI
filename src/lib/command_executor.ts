import { Command } from '@tauri-apps/plugin-shell';
import { type as getOsType } from '@tauri-apps/plugin-os';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { ShellType } from '@/types/prompt';

// 定义高风险命令关键词
const DANGEROUS_KEYWORDS = [
  'rm ', 'del ', 'remove-item',
  'mv ', 'move ',
  'format', 'mkfs',
  '>',
  'chmod ', 'chown ', 'icacls '
];

// 风险检测函数
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

/**
 * 将字符串转换为 PowerShell -EncodedCommand 所需的 UTF-16LE Base64 格式
 * 这能完美解决 Windows 命令行中复杂的引号和特殊字符转义问题
 */
function toPowershellEncodedCommand(script: string): string {
  const utf16leBytes: number[] = [];
  for (let i = 0; i < script.length; i++) {
    const charCode = script.charCodeAt(i);
    utf16leBytes.push(charCode & 0xFF); // low byte
    utf16leBytes.push(charCode >> 8);  // high byte
  }
  // 将字节数组转换为二进制字符串
  const binaryString = String.fromCharCode(...utf16leBytes);
  // Base64 编码
  return btoa(binaryString);
}

/**
 * 核心执行函数 (V7 - 最终稳定版)
 * @param commandStr 要执行的命令
 * @param shell 用户指定的 Shell
 * @param cwd 可选的工作目录
 */
export async function executeCommand(commandStr: string, shell: ShellType = 'auto', cwd?: string | null) {
  // 安全审查
  if (checkCommandRisk(commandStr)) {
    const confirmed = await ask(
      `警告：此命令包含潜在的高风险操作 (如删除、覆盖、修改权限等)。\n\n命令: "${commandStr}"\n\n确定要继续执行吗？`,
      { title: '高风险操作确认', kind: 'warning', okLabel: '继续执行', cancelLabel: '取消' }
    );
    if (!confirmed) return;
  }

  const osType = await getOsType();
  // 修复泛型类型错误
  let command: Command<string>;

  switch (osType) {
    case 'windows': {
      const effectiveShell = (shell === 'auto' || (shell !== 'cmd' && shell !== 'powershell')) ? 'powershell' : shell;
      
      if (effectiveShell === 'powershell') {
        // --- 核心修正：使用 EncodedCommand 方案 ---
        
        // 1. 只有当 cwd 存在时才生成 Set-Location 命令，防止对 null 调用 replace
        // 注意：PowerShell 中单引号转义为两个单引号 (' -> '')
        const setLocationScript = cwd ? `Set-Location -Path '${cwd.replace(/'/g, "''")}';` : '';

        // 2. 构造完整的 PowerShell 脚本
        const script = `
          ${setLocationScript}
          ${commandStr}
          Write-Host -NoNewLine "\\n--- [CodeForge] Command finished. Press any key to continue... ---"
          $host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") | Out-Null
        `;
        
        // 3. 编码脚本
        const encodedCommand = toPowershellEncodedCommand(script);
        
        // 4. 通过 cmd start 启动一个新的 powershell 窗口来执行编码后的命令
        command = Command.create('cmd', [
            '/c', 
            'start', 
            '""', 
            'powershell', 
            '-NoExit', 
            '-EncodedCommand', 
            encodedCommand
        ]);

      } else { // cmd
        const cmdCommand = cwd ? `cd /d "${cwd}" && ${commandStr}` : commandStr;
        command = Command.create('cmd', ['/k', `${cmdCommand} & echo. & pause`]);
      }
      break;
    }

    case 'macos': {
      const effectiveShell = (shell === 'auto' || shell === 'cmd' || shell === 'powershell') ? 'bash' : shell;
      const finalCommand = `${cwd ? `cd "${cwd}" && ` : ''}${commandStr}; echo; read -p "[CodeForge] Command finished. Press Enter to close."`;
      
      const script = `
        tell application "Terminal"
          activate
          do script "exec ${effectiveShell} -c '${finalCommand.replace(/'/g, "'\\''")}'"
        end tell
      `;
      command = Command.create('osascript', ['-e', script]);
      break;
    }

    case 'linux': {
      const effectiveShell = (shell === 'auto' || shell === 'cmd' || shell === 'powershell') ? 'bash' : shell;
      const finalCommand = `${cwd ? `cd "${cwd}" && ` : ''}${commandStr}; echo; read -p "[CodeForge] Command finished. Press Enter to close."`;
      
      command = Command.create('x-terminal-emulator', [
          '-e', 
          `${effectiveShell} -c "${finalCommand.replace(/"/g, '\\"')}"`
      ]);
      break;
    }

    default:
      await showNotification(`Unsupported OS: ${osType}`, "error");
      return;
  }

  try {
    console.log(`Spawning command...`);
    await command.spawn();
  } catch (e: any) {
    console.error("Failed to execute command:", e);
    if (osType === 'linux' && e.message?.includes('No such file or directory')) {
        await showNotification(`执行失败: 未找到 'x-terminal-emulator'。请尝试安装它或配置您的系统。`, "error");
    } else {
        await showNotification(`执行失败: ${e.message || e}`, "error");
    }
  }
}