import { plugin } from '../src';
import { buildSchema, parse } from 'graphql';

const OUTPUT_FILE = 'GrapghQL/Client/TestPackage.pm';

describe('My Plugin', () => {
  const schema = buildSchema(/* GraphQL */ `
    scalar Date
    scalar ID

    schema {
      query: Query
    }

    type Query {
      me: User!
      user(id: ID!): User
      allUsers: [User]
      search(term: String!): [SearchResult!]!
      myChats: [Chat!]!
    }

    enum Role {
      USER
      ADMIN
    }

    interface Node {
      id: ID!
    }

    union SearchResult = User | Chat | ChatMessage

    input UserInput {
      username: String!
      email: String!
      role: Role!
    }

    type User implements Node {
      id: ID!
      username: String!
      email: String!
      role: Role!
    }

    type Chat implements Node {
      id: ID!
      users: [User!]!
      messages: [ChatMessage!]!
    }

    type ChatMessage implements Node {
      id: ID!
      content: String!
      time: Date!
      user: User!
    }
  `);
  const ast = {
    document: parse(/* GraphQL */ `
      query findUser($userId: ID!) {
        user(id: $userId) {
          ...UserFields
        }
      }

      mutation createUser($username: String, $email: String, $role: Role) {
        createUser(input: { username: $username, email: $email, role: $role })
      }

      fragment UserFields on User {
        id
        username
        role
      }
    `),
  };
  it('Should greet', async () => {
    const result = await plugin(
      schema,
      [ast],
      {
        packageName: 'GrapghQL::Client::TestPackage',
        scalars: {
          ID: 'Str',
          String: 'Str',
          Date: 'DateTime',
        },
      },
      {
        outputFile: OUTPUT_FILE,
      }
    );
    expect(result).not.toBeNull();

    //     expect(result).toBe(`
    // pacage GrapghQl::Client::TestPackage;

    // use Moose;

    // 1;
    // `);
  });
});
