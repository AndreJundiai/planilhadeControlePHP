<?php




class Usuario {
    private $conexao;

    public function __construct($conexao) {
        $this->conexao = $conexao;
    }

    public function cadastrar($nome, $email, $senha) {
        $sql = "INSERT INTO usuarios (nome, email, senha) VALUES (:nome, :email, :senha)";
        $stmt = $this->conexao->prepare($sql);
        
        // Criptografar a senha antes de salvar no banco
        $senhaHash = password_hash($senha, PASSWORD_DEFAULT);

        $stmt->bindParam(':nome', $nome);
        $stmt->bindParam(':email', $email);
        $stmt->bindParam(':senha', $senhaHash);

        try {
            $stmt->execute();
            return "Usuário cadastrado com sucesso!";
        } catch (PDOException $e) {
            return "Erro ao cadastrar usuário: " . $e->getMessage();
        }
    }
}
?>
