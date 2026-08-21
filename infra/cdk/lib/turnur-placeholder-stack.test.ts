import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { TurnurPlaceholderStack } from './turnur-placeholder-stack';

describe('TurnurPlaceholderStack', () => {
  it('synthesizes a template with zero AWS resources', () => {
    const app = new cdk.App();
    const stack = new TurnurPlaceholderStack(app, 'TurnurPlaceholderStackTest');
    const template = Template.fromStack(stack);

    expect(template.toJSON().Resources).toBeUndefined();
  });
});
