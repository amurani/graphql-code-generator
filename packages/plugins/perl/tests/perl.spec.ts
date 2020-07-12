import '@graphql-codegen/testing';
import { plugin } from '../src';
import { buildSchema, parse } from 'graphql';
import { readFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_FILE = 'GrapghQL/Client/TestPackage.pm';

describe('Perl Plugin', () => {
  const typesSchema = readFileSync(join(__dirname, 'types-schema.graphql'), 'utf8');
  const operationsSchema = readFileSync(join(__dirname, 'operations-schema.graphql'), 'utf8');

  const schema = buildSchema(typesSchema);
  const ast = {
    document: parse(operationsSchema),
  };

  it('should generate perl types and operations okay', async () => {
    const result = await plugin(
      schema,
      [ast],
      {
        packageName: 'GrapghQL::Client::TestPackage',
        scalars: {
          ID: 'Int|Str',
          Int: 'Int',
          String: 'Str',
          Date: 'DateTime',
        },
      },
      {
        outputFile: OUTPUT_FILE,
      }
    );

    expect(result).not.toBeNull();
    // types are generated okay
    expect(result).toBeSimilarStringTo(`
      package GrapghQL::Client::TestPackage::Types::User;

      use Moose;
      use Moose::Util::TypeConstraints;
      with 'GrapghQL::Client::TestPackage::Types::Roles';

      extends 'GrapghQL::Client::TestPackage::Types::Node';

      has 'id' => (
          is => 'ro',
          isa => 'Int|Str',
          required => 1
      );

      has 'username' => (
          is => 'ro',
          isa => 'Str',
          required => 1
      );

      has 'email' => (
          is => 'ro',
          isa => 'Str',
          required => 1
      );

      has 'role' => (
          is => 'ro',
          isa => 'GrapghQL::Client::TestPackage::Types::Role',
          required => 1
      );


      no Moose;
      no Moose::Util::TypeConstraints;

      1;`);

    // queries are generated okay
    expect(result).toBeSimilarStringTo(`
      package GrapghQL::Client::TestPackage::Types::Query;

      use Moose;
      use Moose::Util::TypeConstraints;
      with 'GrapghQL::Client::TestPackage::Types::Roles';


      has 'me' => (
          is => 'ro',
          isa => 'GrapghQL::Client::TestPackage::Types::User',
          required => 1
      );

      has 'user' => (
          is => 'ro',
          isa => 'GrapghQL::Client::TestPackage::Types::User',
          required => 0
      );

      has 'allUsers' => (
          is => 'ro',
          isa => 'ArrayRef[GrapghQL::Client::TestPackage::Types::User]',
          required => 0
      );

      has 'search' => (
          is => 'ro',
          isa => 'ArrayRef[GrapghQL::Client::TestPackage::Types::SearchResult]',
          required => 1
      );

      has 'myChats' => (
          is => 'ro',
          isa => 'ArrayRef[GrapghQL::Client::TestPackage::Types::Chat]',
          required => 1
      );


      no Moose;
      no Moose::Util::TypeConstraints;

      1;`);
  });
});
