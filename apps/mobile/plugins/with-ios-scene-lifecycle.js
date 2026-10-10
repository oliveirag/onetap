// iOS 27 asserts at launch unless the app adopts the UIScene life cycle. Expo SDK 57 ships
// `ExpoAppSceneDelegate` for this, but its app template still creates the window in the app
// delegate. This plugin registers the scene delegate and lets it own the window.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE = 'EXExpoAppSceneDelegate';

const WINDOW_START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function patchAppDelegate(contents) {
  if (contents.includes('ExpoReactNativeFactoryProvider')) return contents;
  if (!WINDOW_START.test(contents)) {
    throw new Error('with-ios-scene-lifecycle: AppDelegate.swift no longer matches the Expo template');
  }
  return contents
    .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
    .replace(WINDOW_START, '\n    // ExpoAppSceneDelegate creates the window and starts React Native.\n');
}

module.exports = function withIosSceneLifecycle(config) {
  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('with-ios-scene-lifecycle: expected a Swift AppDelegate');
    }
    cfg.modResults.contents = patchAppDelegate(cfg.modResults.contents);
    return cfg;
  });
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE,
          },
        ],
      },
    };
    return cfg;
  });
};

module.exports.patchAppDelegate = patchAppDelegate;
