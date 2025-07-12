import fs from 'fs'
import path from 'path'
import inquirer from 'inquirer'

const apacheDefault = '/opt/bitnami/apache2/conf/httpd.conf'
const nginxDefault = '/opt/bitnami/nginx/conf/nginx.conf'

async function checkRealIPConfig() {
  try {
    const { serverType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'serverType',
        message: 'What web server are you using?',
        choices: ['Apache', 'Nginx'],
      },
    ])

    const { confPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'confPath',
        message: `Enter the path to your ${serverType} config file (this is just for a check, it won't be modified):`,
        default: serverType === 'Apache' ? apacheDefault : nginxDefault,
      },
    ])

    const resolvedPath = path.resolve(confPath)
    if (!fs.existsSync(resolvedPath)) {
      console.warn(`[WARNING] Config file not found at ${resolvedPath}`)
      return
    }

    const confContent = fs.readFileSync(resolvedPath, 'utf-8')

    if (
      confContent.includes('RemoteIPHeader') ||
      confContent.includes('real_ip_header') ||
      confContent.includes('mod_remoteip')
    ) {
      console.log('[SUCCESS] Real IP logic already appears to be configured.')
    } else {
      console.warn(`[WARNING] Your server does not appear to be configured to pass the real visitor IP address.`)
      console.warn(`   If not configured, Cloudflare proxy IPs may be blocked instead of the actual attacker IPs.`)

      console.warn(`\n   Please follow the official guide to enable real IP support:`);
      console.warn(`   https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers/#connecting-ip`);

      console.warn(`\n   Example Apache config:`);
      console.warn(`     LoadModule remoteip_module modules/mod_remoteip.so`);
      console.warn(`     RemoteIPHeader CF-Connecting-IP`);
      console.warn(`     RemoteIPTrustedProxy 173.245.48.0/20`);
      console.warn(`     RemoteIPTrustedProxy 103.21.244.0/22`);
      console.warn(`     # (Add all Cloudflare IP ranges)`);

      console.warn(`\n   Example Nginx config:`);
      console.warn(`     real_ip_header CF-Connecting-IP;`);
      console.warn(`     set_real_ip_from 173.245.48.0/20;`);
      console.warn(`     set_real_ip_from 103.21.244.0/22;`);
      console.warn(`     # (Add all Cloudflare IP ranges)`);

      console.warn(`\n   Full Cloudflare IP list: https://www.cloudflare.com/ips/`);
    }
  } catch (err) {
    console.warn(`[WARNING] Real IP config check failed or was skipped.`, err.message)
  }
}

checkRealIPConfig()