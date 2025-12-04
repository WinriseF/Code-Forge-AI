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
            // 1. 构造要在新窗口中执行的脚本
            const setLocationScript = cwd ? `Set-Location -Path '${cwd.replace(/'/g, "''")}';` : '';
            const script = `
            ${setLocationScript}
            ${commandStr}
            Write-Host -NoNewLine "\\n--- [CodeForge] Command finished. Press any key to continue... ---"
            $host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") | Out-Null
            `;
            
            // 2. 编码脚本
            const encodedCommand = toPowershellEncodedCommand(script);

            // 3. 【核心改动】使用 Start-Process 来启动新的 PowerShell 窗口
            // 这是最稳定、最推荐的方式，可以完全避免 cmd start 的各种问题
            const startProcessArgs = `-NoExit -EncodedCommand ${encodedCommand}`;
            const workingDirectory = cwd ? cwd.replace(/'/g, "''") : undefined; // Start-Process 使用 -WorkingDirectory 参数
            
            // 构造完整的 Start-Process 命令字符串
            // 注意：我们将参数列表作为一个整体传递给 -ArgumentList
            const startProcessCommand = `Start-Process -FilePath 'powershell.exe' -ArgumentList '${startProcessArgs}'${workingDirectory ? ` -WorkingDirectory '${workingDirectory}'` : ''}`;

            // 执行这个 Start-Process 命令
            command = Command.create('powershell', ['-Command', startProcessCommand]);

        } else { // cmd
            const cmdCommand = cwd ? `cd /d "${cwd}" && ${commandStr}` : commandStr;
            // 对于 cmd，我们也可以尝试用 Start-Process，但为了保持一致性，先保留原来的方法
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