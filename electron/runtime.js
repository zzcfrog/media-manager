const path = require('path');

function runtimeConfig({ packaged, appRoot, resources, userData, modelPaths = {}, env = process.env }) {
  const library = env.MEDIA_MANAGER_HOME || (packaged ? path.join(userData, 'library') : path.join(appRoot, '..', 'data'));
  const command = packaged ? path.join(resources, 'backend', 'media-manager-backend') : (env.MEDIA_MANAGER_PYTHON || 'python3');
  const args = packaged ? [] : [path.join(appRoot, '..', 'desktop_backend.py')];
  const hfHome = env.HF_HOME || modelPaths.hfHome || path.join(require('os').homedir(), '.cache', 'huggingface');
  return { command, args, library, env: {
    ...env, ELECTRON: '1', MEDIA_MANAGER_HOME: library,
    MEDIA_MANAGER_MODELS: env.MEDIA_MANAGER_MODELS || modelPaths.modelsDir || (packaged ? path.join(userData, '..', 'Media Manager Models') : path.join(appRoot, '..', 'backend', 'models')),
    MEDIA_MANAGER_RESOURCES: packaged ? resources : path.join(appRoot, 'resources'),
    HF_HOME: hfHome,
    ...(packaged ? { HF_HUB_CACHE: env.HF_HUB_CACHE || path.join(hfHome, 'hub'),
      PATH: path.join(resources, 'tools', 'bin') + path.delimiter + '/usr/bin:/bin:/usr/sbin:/sbin',
      PERL5LIB: path.join(resources, 'tools', 'exiftool', 'lib', 'perl5') } : {}),
  }};
}
module.exports = { runtimeConfig };
