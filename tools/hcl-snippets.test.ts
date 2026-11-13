import { describe, expect, it } from 'vitest';
import { extractResourceBlocks } from './hcl-snippets.ts';

describe('extractResourceBlocks', () => {
  it('extracts a simple resource block keyed by address', () => {
    const source = `resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n`;
    expect(extractResourceBlocks(source)).toEqual({
      'aws_vpc.main': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}',
    });
  });

  it('keeps nested blocks and returns multiple resources in one file', () => {
    const source = [
      'resource "aws_lb_listener" "http" {',
      '  default_action {',
      '    type = "forward"',
      '  }',
      '}',
      '',
      'resource "aws_vpc" "main" {',
      '  cidr_block = "10.0.0.0/16"',
      '}',
    ].join('\n');
    const blocks = extractResourceBlocks(source);
    expect(Object.keys(blocks)).toEqual(['aws_lb_listener.http', 'aws_vpc.main']);
    expect(blocks['aws_lb_listener.http']).toContain('default_action {');
    expect(blocks['aws_lb_listener.http']?.endsWith('}')).toBe(true);
    expect(blocks['aws_vpc.main']).not.toContain('default_action');
  });

  it('ignores braces inside strings, interpolation, and escaped quotes', () => {
    const source = [
      'resource "aws_s3_bucket" "b" {',
      '  bucket = "a}b{c"',
      '  note   = "quote \\" and brace }"',
      '  arn    = "${aws_vpc.main.arn}/*"',
      '  nested = "${join(",", ["}", "{"])}"',
      '}',
      'resource "aws_vpc" "after" {',
      '}',
    ].join('\n');
    const blocks = extractResourceBlocks(source);
    expect(Object.keys(blocks)).toEqual(['aws_s3_bucket.b', 'aws_vpc.after']);
    expect(blocks['aws_s3_bucket.b']).toContain('nested = ');
  });

  it('ignores braces in comments', () => {
    const source = [
      'resource "aws_vpc" "main" {',
      '  # a stray } in a comment',
      '  // another { here',
      '  /* and } this { one */',
      '  cidr_block = "10.0.0.0/16"',
      '}',
    ].join('\n');
    expect(extractResourceBlocks(source)['aws_vpc.main']).toContain('cidr_block');
  });

  it('skips heredoc bodies that contain braces', () => {
    const source = [
      'resource "aws_iam_policy" "p" {',
      '  policy = <<-EOT',
      '    { "Version": "2012-10-17" }',
      '    }}}',
      '  EOT',
      '}',
      'resource "aws_vpc" "after" {',
      '}',
    ].join('\n');
    const blocks = extractResourceBlocks(source);
    expect(Object.keys(blocks)).toEqual(['aws_iam_policy.p', 'aws_vpc.after']);
  });

  it('ignores non-resource blocks and commented-out resources', () => {
    const source = [
      'provider "aws" {',
      '  region = "us-east-1"',
      '}',
      'data "aws_caller_identity" "me" {}',
      '# resource "aws_vpc" "ghost" {',
      '# }',
      'resource "aws_vpc" "real" {',
      '}',
    ].join('\n');
    expect(Object.keys(extractResourceBlocks(source))).toEqual(['aws_vpc.real']);
  });

  it('starts the snippet at the keyword even when the block is indented', () => {
    const blocks = extractResourceBlocks(`  resource "aws_vpc" "main" {\n  }\n`);
    expect(blocks['aws_vpc.main']?.startsWith('resource ')).toBe(true);
  });

  it('throws on an unterminated block', () => {
    expect(() => extractResourceBlocks('resource "aws_vpc" "main" {\n  cidr_block = "x"\n')).toThrow(
      /Unterminated resource block: aws_vpc\.main/,
    );
  });
});
