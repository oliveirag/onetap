// iOS 27 asserts at launch unless the app adopts the UIScene life cycle. Expo SDK 57 ships
// ExpoAppSceneDelegate for this, but the prebuild template still starts React Native from the
// app delegate. This plugin wires the scene delegate in and stops the app delegate creating a window.
// Remove once the Expo template adopts scenes by default.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const WINDOW_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });

  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('ExpoReactNativeFactoryProvider')) return cfg;

    const header = 'class AppDelegate: ExpoAppDelegate {';
    if (!src.includes(header) || !WINDOW_BLOCK.test(src)) {
      throw new Error('with-scene-lifecycle: AppDelegate.swift no longer matches the expected template. Update the plugin.');
    }
    src = src.replace(header, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    src = src.replace(WINDOW_BLOCK, '\n    // The window and React Native start in ExpoAppSceneDelegate (scene life cycle).\n');
    cfg.modResults.contents = src;
    return cfg;
  });
};
