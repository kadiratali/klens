// One-line client code snippets for a locator suggestion.

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const SNIPPET_LANGS = ['java', 'python', 'js'];

export function locatorSnippet(lang, loc) {
  const { strategy, selector, meta } = loc;
  const v = esc(selector);
  if (lang === 'java') {
    switch (strategy) {
      case 'accessibility-id':
        return `driver.findElement(AppiumBy.accessibilityId("${v}"))`;
      case 'id':
        return `driver.findElement(AppiumBy.id("${v}"))`;
      case 'text':
        return `driver.findElement(AppiumBy.androidUIAutomator("new UiSelector().text(\\"${v}\\")"))`;
      case 'class-instance':
        return `driver.findElement(AppiumBy.androidUIAutomator("new UiSelector().className(\\"${esc(meta.className)}\\").instance(${meta.instance})"))`;
      case 'xpath':
        return `driver.findElement(AppiumBy.xpath("${v}"))`;
    }
  }
  if (lang === 'python') {
    switch (strategy) {
      case 'accessibility-id':
        return `driver.find_element(AppiumBy.ACCESSIBILITY_ID, "${v}")`;
      case 'id':
        return `driver.find_element(AppiumBy.ID, "${v}")`;
      case 'text':
        return `driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().text("${selector.replace(/"/g, '\\"')}")')`;
      case 'class-instance':
        return `driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().className("${meta.className}").instance(${meta.instance})')`;
      case 'xpath':
        return `driver.find_element(AppiumBy.XPATH, "${v}")`;
    }
  }
  if (lang === 'js') {
    switch (strategy) {
      case 'accessibility-id':
        return `await $('~${selector}')`;
      case 'id':
        return `await $('android=new UiSelector().resourceId("${v}")')`;
      case 'text':
        return `await $('android=new UiSelector().text("${v}")')`;
      case 'class-instance':
        return `await $('android=new UiSelector().className("${esc(meta.className)}").instance(${meta.instance})')`;
      case 'xpath':
        return `await $('${selector.replace(/'/g, "\\'")}')`;
    }
  }
  return selector;
}

export const STRATEGY_LABELS = {
  'accessibility-id': 'accessibility id',
  id: 'resource-id',
  text: 'text',
  'class-instance': 'class + instance',
  xpath: 'xpath',
};
