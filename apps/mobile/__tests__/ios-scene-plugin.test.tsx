const { patchAppDelegate } = require('../plugins/with-ios-scene-lifecycle');

// The window-creation block of Expo SDK 57's AppDelegate.swift template.
const TEMPLATE = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;

describe('with-ios-scene-lifecycle', () => {
  it('hands window creation to the scene delegate', () => {
    const out = patchAppDelegate(TEMPLATE);
    expect(out).toContain('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    expect(out).not.toContain('startReactNative');
    expect(out).not.toContain('UIScreen.main.bounds');
    expect(out).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
  });

  it('is idempotent', () => {
    const once = patchAppDelegate(TEMPLATE);
    expect(patchAppDelegate(once)).toBe(once);
  });

  it('fails loudly if the template changes', () => {
    expect(() => patchAppDelegate('class AppDelegate: ExpoAppDelegate {}')).toThrow(/no longer matches/);
  });
});
