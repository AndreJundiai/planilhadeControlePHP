<?php
	
	
    //Cria a conexao
      $conexao = new mysqli("localhost", "root", "1234", "novoBD");
    if ($conexao->connect_error) {
        die("Erro de conexão com o banco de dados: " . $conexao->connect_error);
    }

?>
